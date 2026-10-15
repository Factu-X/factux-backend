import { describe, expect, it } from "vitest";

import {
  assertOrdenFinalizable,
  assertRolPuedeActualizarOrden,
  assertTransicionOrden,
  canTransitionOrden,
} from "../src/modules/ordenes/ordenes.policy.js";
import { HttpError } from "../src/shared/http-error.js";

const statusOf = (fn: () => void) => {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof HttpError ? error.statusCode : "unexpected";
  }
};

describe("order state transitions", () => {
  it("follows the workshop flow ABIERTA -> EN_PROCESO -> FINALIZADA", () => {
    expect(canTransitionOrden("ABIERTA", "EN_PROCESO")).toBe(true);
    expect(canTransitionOrden("EN_PROCESO", "FINALIZADA")).toBe(true);
  });

  it("allows returning an in-progress order to ABIERTA and cancelling open work", () => {
    expect(canTransitionOrden("EN_PROCESO", "ABIERTA")).toBe(true);
    expect(canTransitionOrden("ABIERTA", "CANCELADA")).toBe(true);
    expect(canTransitionOrden("EN_PROCESO", "CANCELADA")).toBe(true);
  });

  it("does not finalize without passing through EN_PROCESO", () => {
    expect(canTransitionOrden("ABIERTA", "FINALIZADA")).toBe(false);
    expect(statusOf(() => assertTransicionOrden("ABIERTA", "FINALIZADA"))).toBe(400);
  });

  it("keeps closed orders closed", () => {
    expect(canTransitionOrden("FINALIZADA", "ABIERTA")).toBe(false);
    expect(canTransitionOrden("CANCELADA", "EN_PROCESO")).toBe(false);
  });

  it("treats keeping the same state as a no-op", () => {
    expect(canTransitionOrden("ABIERTA", "ABIERTA")).toBe(true);
  });

  it("requires at least one item to finalize", () => {
    expect(statusOf(() => assertOrdenFinalizable(0))).toBe(400);
    expect(statusOf(() => assertOrdenFinalizable(2))).toBeNull();
  });
});

describe("order updates by role", () => {
  it("lets admin and billing edit any field", () => {
    const input = { motivoIngreso: "Cambio", kilometrajeIngreso: 100, estado: "CANCELADA" as const };

    expect(statusOf(() => assertRolPuedeActualizarOrden("ADMINISTRADOR", input))).toBeNull();
    expect(statusOf(() => assertRolPuedeActualizarOrden("FACTURACION", input))).toBeNull();
  });

  it("limits the operator to state and notes", () => {
    expect(
      statusOf(() =>
        assertRolPuedeActualizarOrden("OPERADOR", { estado: "FINALIZADA", observaciones: "ok" }),
      ),
    ).toBeNull();
    expect(
      statusOf(() => assertRolPuedeActualizarOrden("OPERADOR", { kilometrajeIngreso: 5 })),
    ).toBe(403);
  });

  it("does not let the operator cancel", () => {
    expect(statusOf(() => assertRolPuedeActualizarOrden("OPERADOR", { estado: "CANCELADA" }))).toBe(
      403,
    );
  });
});
