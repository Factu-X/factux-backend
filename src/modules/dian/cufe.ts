import { createHash } from "node:crypto";

const sha384 = (value: string) => createHash("sha384").update(value, "utf8").digest("hex");

// Ambiente segun el anexo tecnico: 1 = produccion, 2 = pruebas (habilitacion).
export type TipoAmbiente = "1" | "2";

export type CufeInput = {
  numero: string;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM:SS-05:00
  valorBruto: string; // LineExtensionAmount con 2 decimales
  iva: string;
  inc: string;
  ica: string;
  valorTotal: string; // PayableAmount con 2 decimales
  nitEmisor: string;
  documentoAdquirente: string;
  ambiente: TipoAmbiente;
};

// Anexo tecnico 1.9, seccion del CUFE: los impuestos van siempre en el orden 01 (IVA), 04 (INC), 03 (ICA).
const cadenaDocumento = (input: CufeInput, llave: string) =>
  [
    input.numero,
    input.fecha,
    input.hora,
    input.valorBruto,
    "01",
    input.iva,
    "04",
    input.inc,
    "03",
    input.ica,
    input.valorTotal,
    input.nitEmisor,
    input.documentoAdquirente,
    llave,
    input.ambiente,
  ].join("");

// La factura usa la clave tecnica de la resolucion.
export const calcularCufe = (input: CufeInput, claveTecnica: string) =>
  sha384(cadenaDocumento(input, claveTecnica));

// Las notas credito y debito usan el PIN del software en lugar de la clave tecnica.
export const calcularCude = (input: CufeInput, pinSoftware: string) =>
  sha384(cadenaDocumento(input, pinSoftware));

export const calcularSoftwareSecurityCode = (softwareId: string, pin: string, numero: string) =>
  sha384(`${softwareId}${pin}${numero}`);
