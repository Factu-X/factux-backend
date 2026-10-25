// Reglas puras de HU-13: se prueban sin base de datos.
import "temporal-polyfill/global";

const DIAS_AVISO_VIGENCIA = 30;
const PORCENTAJE_AVISO_RANGO = 0.1;

export const SECRETOS = {
  claveTecnica: "factux_dian_clave_tecnica",
  pin: "factux_dian_pin",
  certificadoPassword: "factux_dian_certificado_password",
} as const;

// Pesos oficiales de la DIAN para el digito de verificacion, del digito menos significativo al mas.
const PESOS_DV = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

export const calcularDvNit = (nit: string) => {
  const suma = [...nit]
    .reverse()
    .reduce((acc, digito, index) => acc + Number(digito) * PESOS_DV[index]!, 0);
  const residuo = suma % 11;

  return String(residuo > 1 ? 11 - residuo : residuo);
};

export type EmpresaConfig = {
  nit: string;
  digitoVerificacion: string | null;
  razonSocial: string;
  direccion: string | null;
  ciudad: string | null;
  departamento: string | null;
  codigoMunicipio: string | null;
  telefono: string | null;
  email: string | null;
  responsabilidadesFiscales: string | null;
};

export type NumeracionConfig = {
  ambiente: "HABILITACION" | "PRODUCCION";
  numeroResolucion: string | null;
  fechaResolucion: string | null;
  rangoDesde: number | null;
  rangoHasta: number | null;
  consecutivoActual: number | null;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  softwareId: string | null;
  testSetId: string | null;
  certificadoPath: string | null;
  certificadoExpira: string | null;
};

// consecutivoActual es el ultimo numero emitido; el siguiente nunca baja de rangoDesde.
export const siguienteConsecutivo = (n: Pick<NumeracionConfig, "rangoDesde" | "consecutivoActual">) =>
  n.rangoDesde === null ? null : Math.max(n.rangoDesde, (n.consecutivoActual ?? 0) + 1);

export const evaluarConfiguracion = (
  empresa: EmpresaConfig | null,
  numeracion: NumeracionConfig | null,
  secretos: ReadonlySet<string>,
  hoy: string,
) => {
  const faltantesEmision: string[] = [];
  const faltantesTransmision: string[] = [];
  // No bloquean: avisan que la resolucion esta por vencer o agotarse (HU-13).
  const advertencias: string[] = [];

  if (!empresa) {
    faltantesEmision.push("Datos de la empresa");
  } else {
    const requeridos: [keyof EmpresaConfig, string][] = [
      ["nit", "NIT"],
      ["digitoVerificacion", "Digito de verificacion"],
      ["razonSocial", "Razon social"],
      ["direccion", "Direccion"],
      ["ciudad", "Ciudad"],
      ["departamento", "Departamento"],
      ["codigoMunicipio", "Codigo DANE del municipio"],
      ["telefono", "Telefono"],
      ["email", "Correo electronico"],
      ["responsabilidadesFiscales", "Responsabilidades fiscales"],
    ];
    for (const [campo, etiqueta] of requeridos) {
      if (!empresa[campo]) faltantesEmision.push(etiqueta);
    }
    if (empresa.digitoVerificacion && empresa.digitoVerificacion !== calcularDvNit(empresa.nit)) {
      faltantesEmision.push("Digito de verificacion no corresponde al NIT");
    }
  }

  if (!numeracion) {
    faltantesEmision.push("Resolucion y rango de numeracion");
  } else {
    if (!numeracion.numeroResolucion) faltantesEmision.push("Numero de resolucion");
    if (!numeracion.fechaResolucion) faltantesEmision.push("Fecha de resolucion");
    if (numeracion.rangoDesde === null || numeracion.rangoHasta === null) {
      faltantesEmision.push("Rango de numeracion");
    } else {
      const disponibles = numeracion.rangoHasta - (siguienteConsecutivo(numeracion) ?? 0) + 1;
      const tamanoRango = numeracion.rangoHasta - numeracion.rangoDesde + 1;
      if (disponibles <= 0) {
        faltantesEmision.push("Rango de numeracion agotado");
      } else if (disponibles <= Math.ceil(tamanoRango * PORCENTAJE_AVISO_RANGO)) {
        advertencias.push(`Quedan ${disponibles} numero(s) en el rango autorizado`);
      }
    }
    if (!numeracion.vigenciaDesde || !numeracion.vigenciaHasta) {
      faltantesEmision.push("Vigencia de la resolucion");
    } else if (hoy < numeracion.vigenciaDesde || hoy > numeracion.vigenciaHasta) {
      faltantesEmision.push("Resolucion fuera de vigencia");
    } else {
      const dias = Temporal.PlainDate.from(hoy).until(numeracion.vigenciaHasta).days;
      if (dias <= DIAS_AVISO_VIGENCIA) advertencias.push(`La resolucion vence en ${dias} dia(s)`);
    }
    if (!numeracion.softwareId) faltantesEmision.push("Software ID");
  }

  if (!secretos.has(SECRETOS.claveTecnica)) faltantesEmision.push("Clave tecnica de la resolucion");
  if (!secretos.has(SECRETOS.pin)) faltantesEmision.push("PIN del software");

  if (!numeracion?.certificadoPath || !secretos.has(SECRETOS.certificadoPassword)) {
    faltantesTransmision.push("Certificado digital");
  } else if (numeracion.certificadoExpira && numeracion.certificadoExpira < hoy) {
    faltantesTransmision.push("Certificado digital vencido");
  }
  if (numeracion?.ambiente === "HABILITACION" && !numeracion.testSetId) {
    faltantesTransmision.push("TestSetId de habilitacion");
  }

  return {
    puedeEmitir: faltantesEmision.length === 0,
    faltantesEmision,
    // Transmitir exige ademas todo lo de emision.
    puedeTransmitir: faltantesEmision.length === 0 && faltantesTransmision.length === 0,
    faltantesTransmision,
    advertencias,
  };
};
