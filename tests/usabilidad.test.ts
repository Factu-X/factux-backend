import { describe, expect, it } from "vitest";

import {
  calcularResumen,
  calcularSus,
  generarInforme,
  interpretarSus,
  parseRespuestasSus,
  type SesionResumen,
} from "../src/modules/usabilidad/usabilidad.rules.js";
import { createSesionSchema } from "../src/modules/usabilidad/usabilidad.schemas.js";

describe("usabilidad: puntaje SUS", () => {
  it("la mejor respuesta posible da 100 y la peor da 0", () => {
    expect(calcularSus([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
    expect(calcularSus([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
  });

  it("responder todo neutro (3) da 50", () => {
    expect(calcularSus(Array(10).fill(3))).toBe(50);
  });

  it("calcula un caso conocido: 4,2,5,1,4,2,5,1,4,2 = 85", () => {
    expect(calcularSus([4, 2, 5, 1, 4, 2, 5, 1, 4, 2])).toBe(85);
  });

  it("exige exactamente 10 respuestas", () => {
    expect(() => calcularSus([5, 5, 5])).toThrow();
  });

  it("interpreta el puntaje en los cuatro niveles", () => {
    expect(interpretarSus(90)).toBe("EXCELENTE");
    expect(interpretarSus(72)).toBe("BUENO");
    expect(interpretarSus(55)).toBe("REGULAR");
    expect(interpretarSus(30)).toBe("DEFICIENTE");
  });

  it("lee las respuestas guardadas y rechaza datos corruptos", () => {
    expect(parseRespuestasSus("[4,2,5,1,4,2,5,1,4,2]")).toHaveLength(10);
    expect(() => parseRespuestasSus('{"a":1}')).toThrow();
  });
});

const sesion = (participante: string, sus: number, completadas: boolean[], hallazgos: SesionResumen["hallazgos"] = []): SesionResumen => ({
  participante,
  perfil: "Mecanico",
  fechaSesion: "2026-11-12",
  observaciones: null,
  susPuntaje: sus,
  tareas: completadas.map((completada, i) => ({ tarea: `Tarea ${i + 1}`, completada, errores: completada ? 0 : 2 })),
  hallazgos,
});

describe("usabilidad: resumen e informe", () => {
  const sesiones = [
    sesion("Ana", 80, [true, true], [{ descripcion: "Boton oculto", pantalla: "Ordenes", prioridad: "CRITICA", enBacklog: true, resuelto: false }]),
    sesion("Luis", 60, [true, false]),
  ];

  it("promedia el SUS y calcula la tasa de exito de las tareas", () => {
    const resumen = calcularResumen(sesiones);
    expect(resumen.sesiones).toBe(2);
    expect(resumen.sus).toMatchObject({ promedio: 70, minimo: 60, maximo: 80, nivel: "REGULAR" });
    expect(resumen.tareas.tasaExito).toBe(75);
    expect(resumen.hallazgos).toMatchObject({ total: 1, criticosPendientes: 1, enBacklog: 1 });
  });

  it("sin sesiones no inventa promedios", () => {
    expect(calcularResumen([]).sus.promedio).toBeNull();
    expect(generarInforme([], "2026-11-13")).toContain("Aun no hay sesiones");
  });

  it("el informe incluye resultados, participantes y hallazgos", () => {
    const informe = generarInforme(sesiones, "2026-11-13");
    expect(informe).toContain("# Informe de pruebas de usabilidad");
    expect(informe).toContain("Puntaje SUS promedio: **70**");
    expect(informe).toContain("| Ana |");
    expect(informe).toContain("Boton oculto");
    expect(informe).toContain("En backlog");
  });
});

describe("usabilidad: validacion de la sesion", () => {
  const valida = {
    participante: "Ana",
    susRespuestas: [4, 2, 5, 1, 4, 2, 5, 1, 4, 2],
    tareas: [{ tarea: "Crear una orden", completada: true }],
  };

  it("acepta una sesion completa y asigna valores por defecto", () => {
    const resultado = createSesionSchema.parse(valida);
    expect(resultado.hallazgos).toEqual([]);
    expect(resultado.tareas[0]?.errores).toBe(0);
  });

  it("rechaza respuestas fuera de 1-5, cantidad incorrecta y prioridades desconocidas", () => {
    expect(createSesionSchema.safeParse({ ...valida, susRespuestas: [4, 2, 5, 1, 4, 2, 5, 1, 4, 6] }).success).toBe(false);
    expect(createSesionSchema.safeParse({ ...valida, susRespuestas: [4, 2] }).success).toBe(false);
    expect(createSesionSchema.safeParse({ ...valida, hallazgos: [{ descripcion: "x", prioridad: "URGENTE" }] }).success).toBe(false);
    expect(createSesionSchema.safeParse({ ...valida, tareas: [] }).success).toBe(false);
  });
});
