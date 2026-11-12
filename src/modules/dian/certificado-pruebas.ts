import forge from "node-forge";

// Certificado autofirmado para el ambiente simulado. No sirve ante la DIAN real:
// para habilitacion se necesita un certificado emitido por una entidad acreditada (ONAC).
export const generarCertificadoPruebas = (opciones: {
  nombre: string;
  nit: string;
  password: string;
  anios?: number;
}) => {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + (opciones.anios ?? 2));

  const atributos = [
    { name: "commonName", value: `${opciones.nombre} (PRUEBAS)` },
    { name: "organizationName", value: opciones.nombre },
    { name: "countryName", value: "CO" },
    { shortName: "OU", value: `NIT ${opciones.nit}` },
  ];
  cert.setSubject(atributos);
  cert.setIssuer(atributos);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], opciones.password, {
    algorithm: "3des",
  });

  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
};
