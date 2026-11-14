export const PRIORIDADES = ["CRITICA", "ALTA", "MEDIA", "BAJA"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];

export const PRIORIDAD_LABEL: Record<Prioridad, string> = {
  CRITICA: "Critica",
  ALTA: "Alta",
  MEDIA: "Media",
  BAJA: "Baja",
};

// Tareas representativas (HU-14): como minimo registro de cliente y moto, orden de servicio y consulta.
export const TAREAS_BASE = [
  "Iniciar sesion en el sistema",
  "Registrar un cliente con su motocicleta",
  "Crear una orden de servicio para la motocicleta",
  "Consultar el historial de servicios de la motocicleta",
  "Generar la factura electronica de una orden",
] as const;

export const SUS_PREGUNTAS = 10;

// SUS (Brooke, 1996): preguntas impares puntuan (respuesta - 1), pares (5 - respuesta); la suma x 2.5 da 0-100.
export const calcularSus = (respuestas: readonly number[]): number => {
  if (respuestas.length !== SUS_PREGUNTAS) {
    throw new Error(`El SUS requiere ${SUS_PREGUNTAS} respuestas`);
  }

  const suma = respuestas.reduce((total, respuesta, indice) => total + (indice % 2 === 0 ? respuesta - 1 : 5 - respuesta), 0);
  return Math.round(suma * 2.5 * 100) / 100;
};

export type NivelSus = "EXCELENTE" | "BUENO" | "REGULAR" | "DEFICIENTE";

// Mismos cortes que usa la pantalla; 68 es el promedio de referencia de la industria.
export const interpretarSus = (puntaje: number): NivelSus =>
  puntaje >= 85 ? "EXCELENTE" : puntaje >= 71 ? "BUENO" : puntaje >= 51 ? "REGULAR" : "DEFICIENTE";

export const SUS_PROMEDIO_REFERENCIA = 68;

export const parseRespuestasSus = (texto: string): number[] => {
  const valor: unknown = JSON.parse(texto);

  if (!Array.isArray(valor) || !valor.every((n) => Number.isInteger(n))) {
    throw new Error("sus_respuestas no es un arreglo de enteros");
  }

  return valor as number[];
};

export type SesionResumen = {
  participante: string;
  perfil: string | null;
  fechaSesion: string;
  observaciones: string | null;
  susPuntaje: number;
  tareas: { tarea: string; completada: boolean; errores: number }[];
  hallazgos: { descripcion: string; pantalla: string | null; prioridad: Prioridad; enBacklog: boolean; resuelto: boolean }[];
};

const porcentaje = (parte: number, total: number) => (total === 0 ? 0 : Math.round((parte / total) * 1000) / 10);
const redondear = (valor: number) => Math.round(valor * 10) / 10;

export const calcularResumen = (sesiones: SesionResumen[]) => {
  const puntajes = sesiones.map((s) => s.susPuntaje);
  const promedio = puntajes.length ? puntajes.reduce((a, b) => a + b, 0) / puntajes.length : null;
  const tareas = sesiones.flatMap((s) => s.tareas);
  const hallazgos = sesiones.flatMap((s) => s.hallazgos);

  const porTarea = new Map<string, { realizadas: number; completadas: number; errores: number }>();

  for (const tarea of tareas) {
    const actual = porTarea.get(tarea.tarea) ?? { realizadas: 0, completadas: 0, errores: 0 };
    actual.realizadas += 1;
    actual.completadas += tarea.completada ? 1 : 0;
    actual.errores += tarea.errores;
    porTarea.set(tarea.tarea, actual);
  }

  return {
    sesiones: sesiones.length,
    sus: {
      promedio: promedio === null ? null : redondear(promedio),
      minimo: puntajes.length ? Math.min(...puntajes) : null,
      maximo: puntajes.length ? Math.max(...puntajes) : null,
      nivel: promedio === null ? null : interpretarSus(promedio),
      referencia: SUS_PROMEDIO_REFERENCIA,
    },
    tareas: {
      tasaExito: porcentaje(tareas.filter((t) => t.completada).length, tareas.length),
      erroresTotales: tareas.reduce((total, t) => total + t.errores, 0),
      detalle: [...porTarea.entries()].map(([tarea, datos]) => ({
        tarea,
        ...datos,
        tasaExito: porcentaje(datos.completadas, datos.realizadas),
      })),
    },
    hallazgos: {
      total: hallazgos.length,
      porPrioridad: Object.fromEntries(
        PRIORIDADES.map((p) => [p, hallazgos.filter((h) => h.prioridad === p).length]),
      ) as Record<Prioridad, number>,
      criticosPendientes: hallazgos.filter((h) => h.prioridad === "CRITICA" && !h.resuelto).length,
      enBacklog: hallazgos.filter((h) => h.enBacklog).length,
    },
  };
};

const celda = (texto: string | null) => (texto ?? "-").replaceAll("|", "/").replaceAll("\n", " ");

// Documento de resultados del piloto (criterio final de HU-14): se descarga desde la pantalla.
export const generarInforme = (sesiones: SesionResumen[], generadoEn: string): string => {
  const resumen = calcularResumen(sesiones);
  const lineas: string[] = [
    "# Informe de pruebas de usabilidad - FactuX",
    "",
    `Generado el ${generadoEn}. Sesiones con usuarios piloto: ${resumen.sesiones}.`,
    "",
    "## Resultado general (SUS)",
    "",
  ];

  if (resumen.sus.promedio === null) {
    lineas.push("Aun no hay sesiones registradas.", "");
    return lineas.join("\n");
  }

  lineas.push(
    `- Puntaje SUS promedio: **${resumen.sus.promedio}** (${resumen.sus.nivel?.toLowerCase()}); promedio de referencia de la industria: ${resumen.sus.referencia}.`,
    `- Rango: ${resumen.sus.minimo} a ${resumen.sus.maximo}.`,
    `- Tareas completadas sin ayuda: ${resumen.tareas.tasaExito}% (${resumen.tareas.erroresTotales} errores en total).`,
    "",
    "## Resultados por participante",
    "",
    "| Participante | Perfil | Fecha | SUS | Tareas completadas |",
    "|---|---|---|---|---|",
  );

  for (const s of sesiones) {
    lineas.push(
      `| ${celda(s.participante)} | ${celda(s.perfil)} | ${s.fechaSesion} | ${s.susPuntaje} | ${s.tareas.filter((t) => t.completada).length}/${s.tareas.length} |`,
    );
  }

  lineas.push("", "## Resultados por tarea", "", "| Tarea | Completada | Errores |", "|---|---|---|");

  for (const t of resumen.tareas.detalle) {
    lineas.push(`| ${celda(t.tarea)} | ${t.completadas}/${t.realizadas} (${t.tasaExito}%) | ${t.errores} |`);
  }

  lineas.push("", "## Hallazgos y acciones propuestas", "");

  const hallazgos = sesiones
    .flatMap((s) => s.hallazgos.map((h) => ({ ...h, participante: s.participante })))
    .sort((a, b) => PRIORIDADES.indexOf(a.prioridad) - PRIORIDADES.indexOf(b.prioridad));

  if (hallazgos.length === 0) {
    lineas.push("No se registraron hallazgos.");
  } else {
    lineas.push("| Prioridad | Hallazgo | Pantalla | Reportado por | Estado |", "|---|---|---|---|---|");

    for (const h of hallazgos) {
      const estado = h.resuelto ? "Resuelto" : h.enBacklog ? "En backlog" : "Pendiente";
      lineas.push(
        `| ${PRIORIDAD_LABEL[h.prioridad]} | ${celda(h.descripcion)} | ${celda(h.pantalla)} | ${celda(h.participante)} | ${estado} |`,
      );
    }
  }

  const observaciones = sesiones.filter((s) => s.observaciones);

  if (observaciones.length) {
    lineas.push("", "## Observaciones de las sesiones", "");
    for (const s of observaciones) lineas.push(`- **${celda(s.participante)}:** ${celda(s.observaciones)}`);
  }

  return `${lineas.join("\n")}\n`;
};
