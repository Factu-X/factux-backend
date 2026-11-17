import "temporal-polyfill/global";
import { afterEach, describe, expect, it, vi } from "vitest";

import { celda } from "../src/modules/usabilidad/usabilidad.rules.js";
import { createSesionSchema } from "../src/modules/usabilidad/usabilidad.schemas.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("env: variables de correo vacias (copiar .env.example)", () => {
  it("RESEND_API_KEY y EMAIL_FROM en blanco no tumban el arranque y dejan el correo sin configurar", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");

    const { env } = await import("../src/config/env.js");
    const { correoConfigurado } = await import("../src/shared/email.js");

    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.EMAIL_FROM).toBeUndefined();
    expect(correoConfigurado()).toBe(false);
  });
});

describe("correo: rechazo del proveedor", () => {
  it("un 401 de Resend sale como 503 con mensaje claro y sin filtrar la clave", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_secreta");
    vi.stubEnv("EMAIL_FROM", "Taller <avisos@taller.co>");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));

    const { enviarCorreo } = await import("../src/shared/email.js");
    const error = await enviarCorreo({ para: "a@b.co", asunto: "x", texto: "y" }).catch((e: unknown) => e);

    expect(error).toMatchObject({ statusCode: 503 });
    expect((error as Error).message).toContain("401");
    expect((error as Error).message).not.toContain("re_secreta");
  });
});

describe("usabilidad: informe Markdown", () => {
  it("una celda no se parte con \\r, \\n ni |", () => {
    expect(celda("Ana\r| x |\r\nLuis\nPaz")).toBe("Ana / x / Luis Paz");
  });

  it("escapa el HTML del texto libre", () => {
    expect(celda("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("muestra un guion si no hay texto", () => {
    expect(celda(null)).toBe("-");
  });
});

describe("usabilidad: fecha de la sesion", () => {
  const valida = {
    participante: "Ana",
    susRespuestas: [4, 2, 5, 1, 4, 2, 5, 1, 4, 2],
    tareas: [{ tarea: "Crear una orden", completada: true }],
  };

  it("rechaza una fecha futura y acepta hoy o el pasado", () => {
    const manana = Temporal.Now.plainDateISO("America/Bogota").add({ days: 1 }).toString();
    const hoy = Temporal.Now.plainDateISO("America/Bogota").toString();

    expect(createSesionSchema.safeParse({ ...valida, fechaSesion: manana }).success).toBe(false);
    expect(createSesionSchema.safeParse({ ...valida, fechaSesion: hoy }).success).toBe(true);
    expect(createSesionSchema.safeParse({ ...valida, fechaSesion: "2026-01-15" }).success).toBe(true);
  });

  it("rechaza respuestas SUS no enteras, como texto o un puntaje enviado por el cliente", () => {
    expect(createSesionSchema.safeParse({ ...valida, susRespuestas: [3.5, 2, 5, 1, 4, 2, 5, 1, 4, 2] }).success).toBe(false);
    expect(createSesionSchema.safeParse({ ...valida, susRespuestas: ["3", 2, 5, 1, 4, 2, 5, 1, 4, 2] }).success).toBe(false);
    expect(createSesionSchema.safeParse({ ...valida, susRespuestas: [0, 2, 5, 1, 4, 2, 5, 1, 4, 2] }).success).toBe(false);
    expect(createSesionSchema.safeParse({ ...valida, susPuntaje: 100 }).success).toBe(false);
  });
});
