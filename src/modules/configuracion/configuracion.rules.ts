import "temporal-polyfill/global";

export type ResolucionSnapshot = {
  prefijoFacturacion: string | null;
  numeroResolucion: string | null;
  rangoDesde: number | null;
  rangoHasta: number | null;
  consecutivoActual: number | null;
  vigenciaDesde: Temporal.PlainDate | null;
  vigenciaHasta: Temporal.PlainDate | null;
};

export type ResolucionCompleta = {
  prefijoFacturacion: string | null;
  numeroResolucion: string;
  rangoDesde: number;
  rangoHasta: number;
  consecutivoActual: number | null;
  vigenciaDesde: Temporal.PlainDate;
  vigenciaHasta: Temporal.PlainDate;
};

export type Alerta = {
  nivel: "INFO" | "ADVERTENCIA" | "ERROR";
  mensaje: string;
};

const DIAS_AVISO_VIGENCIA = 30;
const PORCENTAJE_AVISO_RANGO = 0.1;

export const isResolucionCompleta = (
  resolucion: ResolucionSnapshot | null,
): resolucion is ResolucionSnapshot & ResolucionCompleta =>
  !!resolucion &&
  !!resolucion.numeroResolucion &&
  resolucion.rangoDesde !== null &&
  resolucion.rangoHasta !== null &&
  resolucion.vigenciaDesde !== null &&
  resolucion.vigenciaHasta !== null;

// consecutivoActual guarda el ultimo numero emitido; null = todavia no se ha usado el rango.
export const siguienteConsecutivo = (resolucion: ResolucionCompleta) =>
  resolucion.consecutivoActual === null
    ? resolucion.rangoDesde
    : resolucion.consecutivoActual + 1;

export const numerosDisponibles = (resolucion: ResolucionCompleta) =>
  Math.max(0, resolucion.rangoHasta - siguienteConsecutivo(resolucion) + 1);

export const evaluarResolucion = (
  resolucion: ResolucionSnapshot | null,
  hoy: Temporal.PlainDate,
): Alerta[] => {
  if (!isResolucionCompleta(resolucion)) {
    return [
      {
        nivel: "ERROR",
        mensaje: "No hay resolucion de numeracion configurada; no se pueden emitir facturas",
      },
    ];
  }

  const alertas: Alerta[] = [];

  if (Temporal.PlainDate.compare(hoy, resolucion.vigenciaDesde) < 0) {
    alertas.push({ nivel: "ERROR", mensaje: "La resolucion todavia no esta vigente" });
  }

  if (Temporal.PlainDate.compare(hoy, resolucion.vigenciaHasta) > 0) {
    alertas.push({ nivel: "ERROR", mensaje: "La resolucion de numeracion esta vencida" });
  } else {
    const diasRestantes = hoy.until(resolucion.vigenciaHasta, { largestUnit: "day" }).days;

    if (diasRestantes <= DIAS_AVISO_VIGENCIA) {
      alertas.push({
        nivel: "ADVERTENCIA",
        mensaje: `La resolucion vence en ${diasRestantes} dia(s)`,
      });
    }
  }

  const disponibles = numerosDisponibles(resolucion);
  const tamanoRango = resolucion.rangoHasta - resolucion.rangoDesde + 1;

  if (disponibles === 0) {
    alertas.push({ nivel: "ERROR", mensaje: "Se agoto el rango de numeracion autorizado" });
  } else if (disponibles <= Math.ceil(tamanoRango * PORCENTAJE_AVISO_RANGO)) {
    alertas.push({
      nivel: "ADVERTENCIA",
      mensaje: `Quedan ${disponibles} numero(s) en el rango autorizado`,
    });
  }

  return alertas;
};

export const alertaBloqueante = (alertas: Alerta[]) =>
  alertas.find((alerta) => alerta.nivel === "ERROR") ?? null;
