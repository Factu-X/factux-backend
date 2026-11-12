import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  findProfile: vi.fn(),
}));

vi.mock("../src/config/supabase.js", () => ({
  supabase: { auth: { getClaims: mocks.getClaims } },
  supabaseAdmin: null,
}));

vi.mock("../src/prisma/db.js", () => ({
  db: { orm: { public: { Profiles: { first: mocks.findProfile } } } },
}));

const { app } = await import("../src/app.js");
const { invalidateProfileCache } = await import("../src/middlewares/auth.js");

describe("authenticate middleware", () => {
  beforeEach(() => {
    mocks.getClaims.mockReset();
    mocks.findProfile.mockReset();
    invalidateProfileCache();
  });

  it("rejects requests without bearer token", async () => {
    const response = await request(app).get("/api/auth/me").expect(401);

    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });

  it("rejects malformed authorization headers", async () => {
    await request(app).get("/api/auth/me").set("Authorization", "Token abc").expect(401);
  });

  it("rejects tokens whose signature or expiry is invalid", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error("jwt expired") });

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer expired")
      .expect(401);

    expect(response.body.error.message).toBe("Token invalido o expirado");
  });

  it("rejects users without profile", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u-1" } }, error: null });
    mocks.findProfile.mockResolvedValue(null);

    await request(app).get("/api/auth/me").set("Authorization", "Bearer ok").expect(401);
  });

  it("blocks inactive users", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u-1" } }, error: null });
    mocks.findProfile.mockResolvedValue({
      id: "u-1",
      nombre: "Ana",
      rol: "FACTURACION",
      activo: false,
    });

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer ok")
      .expect(403);

    expect(response.body.error.message).toBe("El usuario esta inactivo");
  });

  it("returns the authenticated profile", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u-1" } }, error: null });
    mocks.findProfile.mockResolvedValue({
      id: "u-1",
      nombre: "Ana",
      rol: "FACTURACION",
      activo: true,
      createdAt: "ignored",
    });

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer ok")
      .expect(200);

    expect(response.body.data).toEqual({
      id: "u-1",
      nombre: "Ana",
      rol: "FACTURACION",
      activo: true,
    });
  });

  it("caches the profile so repeated requests skip the database", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u-1" } }, error: null });
    mocks.findProfile.mockResolvedValue({ id: "u-1", nombre: "Ana", rol: "FACTURACION", activo: true });

    await request(app).get("/api/auth/me").set("Authorization", "Bearer ok").expect(200);
    await request(app).get("/api/auth/me").set("Authorization", "Bearer ok").expect(200);
    expect(mocks.findProfile).toHaveBeenCalledTimes(1);

    // Al editar el usuario se invalida y la siguiente peticion ve el cambio de inmediato.
    invalidateProfileCache("u-1");
    mocks.findProfile.mockResolvedValue({ id: "u-1", nombre: "Ana", rol: "FACTURACION", activo: false });
    await request(app).get("/api/auth/me").set("Authorization", "Bearer ok").expect(403);
  });
});
