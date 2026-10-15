import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  findProfile: vi.fn(),
}));

vi.mock("../src/config/supabase.js", () => ({
  supabase: { auth: { getUser: mocks.getUser } },
  supabaseAdmin: null,
}));

vi.mock("../src/prisma/db.js", () => ({
  db: { orm: { public: { Profiles: { first: mocks.findProfile } } } },
}));

const { app } = await import("../src/app.js");

describe("authenticate middleware", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.findProfile.mockReset();
  });

  it("rejects requests without bearer token", async () => {
    const response = await request(app).get("/api/auth/me").expect(401);

    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("rejects malformed authorization headers", async () => {
    await request(app).get("/api/auth/me").set("Authorization", "Token abc").expect(401);
  });

  it("rejects tokens that Supabase does not recognize", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("jwt expired") });

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer expired")
      .expect(401);

    expect(response.body.error.message).toBe("Token invalido o expirado");
  });

  it("rejects users without profile", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    mocks.findProfile.mockResolvedValue(null);

    await request(app).get("/api/auth/me").set("Authorization", "Bearer ok").expect(401);
  });

  it("blocks inactive users", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
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
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
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
});
