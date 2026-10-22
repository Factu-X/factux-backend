import "temporal-polyfill/global";

import type { Linea, Parte } from "../../src/modules/dian/ubl.js";
import type { FacturaXmlInput } from "../../src/modules/facturas/facturas.xml.js";

type DocumentoDemo = {
  numero: string;
  prefijo: string;
  emitidaEn: Temporal.Instant;
  formaPago: "CONTADO" | "CREDITO";
  fechaVencimiento: string | null;
  ambiente: "1" | "2";
  emisor: Parte;
  adquirente: Parte;
  lineas: Linea[];
  resolucion: FacturaXmlInput["resolucion"];
  software: { id: string; pin: string; nitProveedor: string; dvProveedor: string };
  claveTecnica: string;
};

export const documentoDemo = (): DocumentoDemo => ({
  numero: "SETP990000001",
  prefijo: "SETP",
  emitidaEn: Temporal.Instant.from("2026-10-21T15:30:00Z"),
  formaPago: "CONTADO",
  fechaVencimiento: null,
  ambiente: "2",
  emisor: {
    tipoPersona: "1",
    tipoDocumento: "31",
    numeroDocumento: "900123456",
    digitoVerificacion: "8",
    nombre: "FactuX Moto Center",
    responsabilidades: "R-99-PN",
    responsableIva: true,
    ubicacion: {
      municipioCodigo: "05001",
      ciudad: "Medellín",
      departamento: "Antioquia",
      departamentoCodigo: "05",
      direccion: "Calle 10 #20-30",
    },
    telefono: "3001234567",
    email: "contacto@factux-demo.local",
  },
  adquirente: {
    tipoPersona: "2",
    tipoDocumento: "13",
    numeroDocumento: "1020304050",
    digitoVerificacion: null,
    nombre: "Carlos Perez",
    responsabilidades: "R-99-PN",
    responsableIva: false,
    ubicacion: null,
    telefono: null,
    email: "carlos.perez@example.com",
  },
  lineas: [
    {
      codigo: "SERV-ACEITE",
      descripcion: "Cambio de aceite",
      cantidad: "1.00",
      precioUnitario: "35000.00",
      subtotal: "35000.00",
      impuesto: "6650.00",
      tarifaIva: "19.00",
      tratamientoIva: "GRAVADO",
    },
    {
      codigo: "REP-ACEITE-10W40",
      descripcion: "Aceite 10W40",
      cantidad: "1.00",
      precioUnitario: "42000.00",
      subtotal: "42000.00",
      impuesto: "7980.00",
      tarifaIva: "19.00",
      tratamientoIva: "GRAVADO",
    },
    {
      codigo: "REV-SOAT",
      descripcion: "Gestion de tramite",
      cantidad: "1.00",
      precioUnitario: "10000.00",
      subtotal: "10000.00",
      impuesto: "0.00",
      tarifaIva: "0.00",
      tratamientoIva: "EXCLUIDO",
    },
  ],
  resolucion: {
    numero: "18760000001",
    vigenciaDesde: "2019-01-19",
    vigenciaHasta: "2030-01-19",
    rangoDesde: 990000000,
    rangoHasta: 995000000,
  },
  software: { id: "software-id", pin: "12345", nitProveedor: "900123456", dvProveedor: "8" },
  claveTecnica: "fc8eac422eba16e22ffd8c6f94b3f40a6e38162c",
});

// La misma factura en el formato del generador de HU-06 (facturas.xml.ts).
export const facturaDemo = (cambios: Partial<FacturaXmlInput> = {}): FacturaXmlInput => {
  const doc = documentoDemo();
  const ubicacion = doc.emisor.ubicacion!;

  return {
    numero: doc.numero,
    prefijo: doc.prefijo,
    fechaEmision: "2026-10-21",
    horaEmision: "10:30:00-05:00",
    fechaVencimiento: null,
    formaPago: doc.formaPago,
    ambiente: "HABILITACION",
    resolucion: doc.resolucion,
    software: { id: doc.software.id, pin: doc.software.pin },
    claveTecnica: doc.claveTecnica,
    emisor: {
      nit: doc.emisor.numeroDocumento,
      dv: doc.emisor.digitoVerificacion!,
      razonSocial: doc.emisor.nombre,
      nombreComercial: null,
      tipoPersona: "JURIDICA",
      responsabilidadesFiscales: doc.emisor.responsabilidades,
      direccion: ubicacion.direccion,
      ciudad: ubicacion.ciudad,
      departamento: ubicacion.departamento,
      codigoMunicipio: ubicacion.municipioCodigo,
      telefono: doc.emisor.telefono!,
      email: doc.emisor.email!,
    },
    adquiriente: {
      tipoIdentificacion: "CC",
      numeroIdentificacion: doc.adquirente.numeroDocumento,
      dv: null,
      nombre: doc.adquirente.nombre,
      direccion: null,
      telefono: null,
      email: doc.adquirente.email,
    },
    lineas: doc.lineas.map((linea) => ({ ...linea, codigo: linea.codigo ?? "" })),
    ...cambios,
  };
};
