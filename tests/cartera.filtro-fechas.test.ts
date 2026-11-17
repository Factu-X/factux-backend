import { describe, expect, it } from "vitest";

import { carteraQuerySchema } from "../src/modules/cartera/cartera.schemas.js";

describe("carteraQuerySchema (HU-10, filtro por fecha de emision)", () => {
  it("acepta el rango opcional y deja CON_SALDO por defecto", () => {
    expect(carteraQuerySchema.parse({})).toEqual({ filtro: "CON_SALDO" });
    expect(carteraQuerySchema.parse({ desde: "2026-11-01", hasta: "2026-11-30" })).toMatchObject({
      desde: "2026-11-01",
      hasta: "2026-11-30",
    });
    expect(carteraQuerySchema.parse({ desde: "2026-11-16", hasta: "2026-11-16" }).desde).toBe("2026-11-16");
  });

  it("rechaza un rango invertido o una fecha mal escrita", () => {
    expect(carteraQuerySchema.safeParse({ desde: "2026-11-30", hasta: "2026-11-01" }).success).toBe(false);
    expect(carteraQuerySchema.safeParse({ desde: "30/11/2026" }).success).toBe(false);
  });
});
