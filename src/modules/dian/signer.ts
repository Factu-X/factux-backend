import { readFile } from "node:fs/promises";

import * as xmldom from "@xmldom/xmldom";
import forge from "node-forge";
import * as xadesjs from "xadesjs";
import { XmlDsigEnvelopedSignatureTransform } from "xmldsigjs";
import xpath from "xpath";

import { NS } from "./ubl.js";

// Politica de firma v2 publicada por la DIAN y el hash SHA-256 de su PDF.
export const POLITICA_FIRMA = {
  url: "https://facturaelectronica.dian.gov.co/politicadefirma/v2/politicadefirmav2.pdf",
  digest: "dMoMvtcG5aIzgYo0tIsSQeVJBDnUnfSOfBpxXrmor0Y=",
};

const ALGORITMO = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

let configurado = false;

// xmldsigjs solo quita firmas que cuelgan directo de la raiz. La DIAN exige la firma dentro de
// ext:UBLExtension, asi que el transform enveloped debe quitarla donde este (XMLDSig 6.6.4).
const corregirTransformEnveloped = () => {
  XmlDsigEnvelopedSignatureTransform.prototype.GetOutput = function (this: { innerXml: Node | null }) {
    const raiz = this.innerXml as Element | null;

    if (!raiz) {
      throw new Error("El transform enveloped no recibio el documento");
    }

    for (const firma of Array.from(raiz.getElementsByTagNameNS(NS.ds, "Signature"))) {
      firma.parentNode?.removeChild(firma);
    }

    return raiz;
  };
};

const configurarXadesjs = () => {
  if (configurado) return;
  corregirTransformEnveloped();
  xadesjs.setNodeDependencies({
    XMLSerializer: xmldom.XMLSerializer,
    DOMParser: xmldom.DOMParser,
    DOMImplementation: xmldom.DOMImplementation,
    xpath,
  });
  xadesjs.Application.setEngine("NodeJS", globalThis.crypto);
  configurado = true;
};

export type Certificado = {
  privateKey: CryptoKey;
  certificadoBase64: string;
  sujeto: string;
  venceEl: Date;
};

export const leerCertificadoP12 = async (p12: Buffer, password: string): Promise<Certificado> => {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12.toString("binary")));
  const pkcs12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);

  const keyBag = pkcs12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
    forge.pki.oids.pkcs8ShroudedKeyBag
  ]?.[0];
  const certBag = pkcs12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0];

  if (!keyBag?.key || !certBag?.cert) {
    throw new Error("El archivo .p12 no contiene llave privada y certificado");
  }

  const pkcs8Der = forge.asn1
    .toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keyBag.key)))
    .getBytes();
  const privateKey = await globalThis.crypto.subtle.importKey(
    "pkcs8",
    Buffer.from(pkcs8Der, "binary"),
    ALGORITMO,
    false,
    ["sign"],
  );
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certBag.cert)).getBytes();

  return {
    privateKey,
    certificadoBase64: Buffer.from(certDer, "binary").toString("base64"),
    sujeto: certBag.cert.subject.getField("CN")?.value ?? "",
    venceEl: certBag.cert.validity.notAfter,
  };
};

export const cargarCertificado = async (path: string, password: string) =>
  leerCertificadoP12(await readFile(path), password);

// Firma XAdES-EPES enveloped. La firma se ubica en la segunda UBLExtension, como pide el anexo.
export const firmarXml = async (xml: string, certificado: Certificado) => {
  configurarXadesjs();

  const doc = xadesjs.Parse(xml);
  const signedXml = new xadesjs.SignedXml();
  const signature = await signedXml.Sign(ALGORITMO, certificado.privateKey, doc, {
    references: [{ hash: "SHA-256", transforms: ["enveloped"], uri: "" }],
    x509: [certificado.certificadoBase64],
    signingCertificate: { certificate: certificado.certificadoBase64, digestAlgorithm: "SHA-256" },
    policy: {
      hash: "SHA-256",
      identifier: { value: POLITICA_FIRMA.url },
      digestValue: POLITICA_FIRMA.digest,
    },
    signerRole: { claimed: ["supplier"] },
  });

  const contenedor = doc.getElementsByTagNameNS(NS.ext, "ExtensionContent")[1];

  if (!contenedor) {
    throw new Error("El XML no tiene la extension reservada para la firma");
  }

  contenedor.appendChild(signature.GetXml()!);

  return new xmldom.XMLSerializer().serializeToString(doc as unknown as xmldom.Node);
};

export const verificarFirma = async (xml: string) => {
  configurarXadesjs();

  const doc = xadesjs.Parse(xml);
  const nodo = doc.getElementsByTagNameNS(NS.ds, "Signature")[0];

  if (!nodo) return false;

  const signedXml = new xadesjs.SignedXml(doc);
  signedXml.LoadXml(nodo);

  try {
    return await signedXml.Verify();
  } catch {
    return false;
  }
};
