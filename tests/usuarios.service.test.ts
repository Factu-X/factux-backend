import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const updateProfile = vi.fn();

  return {
    createUser: vi.fn(),
    updateUserById: vi.fn(),
    deleteUser: vi.fn(),
    listUsers: vi.fn(),
    findProfile: vi.fn(),
    listProfiles: vi.fn(),
    updateProfile,
    whereProfile: vi.fn(() => ({ update: updateProfile })),
    admin: { enabled: true },
  };
});

vi.mock("../src/config/supabase.js", () => ({
  supabase: {},
  get supabaseAdmin() {
    return mocks.admin.enabled
      ? {
          auth: {
            admin: {
              createUser: mocks.createUser,
              deleteUser: mocks.deleteUser,
              updateUserById: mocks.updateUserById,
              listUsers: mocks.listUsers,
            },
          },
        }
      : null;
  },
}));

vi.mock("../src/prisma/db.js", () => ({
  db: {
    orm: {
      public: {
        Profiles: {
          first: mocks.findProfile,
          where: mocks.whereProfile,
          orderBy: () => ({ all: mocks.listProfiles }),
        },
      },
    },
  },
}));

const { createUsuario, listUsuarios, updateUsuario } = await import(
  "../src/modules/usuarios/usuarios.service.js"
);

const input = {
  nombre: "Ana Facturacion",
  email: "ana@factux.co",
  password: "secreta123",
  rol: "FACTURACION" as const,
};

const profile = { id: "u-1", nombre: "Ana Facturacion", rol: "FACTURACION", activo: true };

describe("usuarios service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.admin.enabled = true;
    mocks.updateUserById.mockResolvedValue({ data: {}, error: null });
  });

  it("creates the auth user and assigns the requested role", async () => {
    mocks.createUser.mockResolvedValue({ data: { user: { id: "u-1", email: input.email } }, error: null });
    mocks.findProfile.mockResolvedValue(profile);

    const result = await createUsuario(input);

    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: { nombre: input.nombre },
      }),
    );
    expect(mocks.whereProfile).toHaveBeenCalledWith({ id: "u-1" });
    expect(mocks.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ rol: "FACTURACION", activo: true }),
    );
    expect(result).toEqual({ ...profile, email: input.email });
  });

  it("removes the auth user when the profile cannot be updated", async () => {
    mocks.createUser.mockResolvedValue({ data: { user: { id: "u-1", email: input.email } }, error: null });
    mocks.updateProfile.mockRejectedValueOnce(new Error("db down"));

    await expect(createUsuario(input)).rejects.toThrow("db down");
    expect(mocks.deleteUser).toHaveBeenCalledWith("u-1");
  });

  it("reports duplicated emails as conflict", async () => {
    mocks.createUser.mockResolvedValue({
      data: { user: null },
      error: { status: 422, code: "email_exists", message: "already registered" },
    });

    await expect(createUsuario(input)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("requires the service role key to create users", async () => {
    mocks.admin.enabled = false;

    await expect(createUsuario(input)).rejects.toMatchObject({ statusCode: 503 });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("lists profiles with their auth emails", async () => {
    mocks.listProfiles.mockResolvedValue([profile, { ...profile, id: "u-2" }]);
    mocks.listUsers.mockResolvedValue({
      data: { users: [{ id: "u-1", email: "ana@factux.co" }] },
      error: null,
    });

    const result = await listUsuarios();

    expect(result).toEqual([
      { ...profile, email: "ana@factux.co" },
      { ...profile, id: "u-2", email: null },
    ]);
  });

  it("lists profiles without emails when the service role key is missing", async () => {
    mocks.admin.enabled = false;
    mocks.listProfiles.mockResolvedValue([profile]);

    expect(await listUsuarios()).toEqual([{ ...profile, email: null }]);
  });

  it("prevents admins from locking themselves out", async () => {
    mocks.findProfile.mockResolvedValue({ ...profile, rol: "ADMINISTRADOR" });

    await expect(updateUsuario("u-1", { activo: false }, "u-1")).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(updateUsuario("u-1", { rol: "OPERADOR" }, "u-1")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("updates other users role and status", async () => {
    mocks.findProfile.mockResolvedValue(profile);

    await updateUsuario("u-1", { rol: "OPERADOR", activo: false }, "admin-id");

    expect(mocks.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ rol: "OPERADOR", activo: false }),
    );
  });

  it("bans deactivated users in Supabase Auth so they cannot sign in", async () => {
    mocks.findProfile.mockResolvedValue(profile);

    await updateUsuario("u-1", { activo: false }, "admin-id");

    expect(mocks.updateUserById).toHaveBeenCalledWith(
      "u-1",
      expect.objectContaining({ ban_duration: "876000h" }),
    );
  });

  it("lifts the ban when the user is reactivated", async () => {
    mocks.findProfile.mockResolvedValue({ ...profile, activo: false });

    await updateUsuario("u-1", { activo: true }, "admin-id");

    expect(mocks.updateUserById).toHaveBeenCalledWith(
      "u-1",
      expect.objectContaining({ ban_duration: "none" }),
    );
  });

  it("changes the login email in Supabase Auth", async () => {
    mocks.findProfile.mockResolvedValue(profile);

    await updateUsuario("u-1", { email: "nuevo@factux.co" }, "admin-id");

    expect(mocks.updateUserById).toHaveBeenCalledWith(
      "u-1",
      expect.objectContaining({ email: "nuevo@factux.co", email_confirm: true }),
    );
  });

  it("rejects an email already used by another account without touching the profile", async () => {
    mocks.findProfile.mockResolvedValue(profile);
    mocks.updateUserById.mockResolvedValue({
      data: {},
      error: { status: 422, code: "email_exists", message: "already registered" },
    });

    await expect(updateUsuario("u-1", { email: "otro@factux.co" }, "admin-id")).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("does not call Supabase Auth when only name or role change", async () => {
    mocks.findProfile.mockResolvedValue(profile);

    await updateUsuario("u-1", { nombre: "Ana Maria", rol: "OPERADOR" }, "admin-id");

    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown users", async () => {
    mocks.findProfile.mockResolvedValue(null);

    await expect(updateUsuario("nope", { nombre: "X Y" }, "admin-id")).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
