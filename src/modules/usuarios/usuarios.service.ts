import { supabaseAdmin } from "../../config/supabase.js";
import { db } from "../../prisma/db.js";
import { badRequest, conflict, notFound, serviceUnavailable } from "../../shared/http-error.js";
import { varchar } from "../../shared/prisma-types.js";
import type { CreateUsuarioInput, UpdateUsuarioInput } from "./usuarios.schemas.js";

const requireAdminClient = () => {
  if (!supabaseAdmin) {
    throw serviceUnavailable(
      "La creacion de usuarios requiere SUPABASE_SERVICE_ROLE_KEY en el backend",
    );
  }

  return supabaseAdmin;
};

// shortcut: una sola pagina de 1000 usuarios de Auth; paginar si el taller supera ese numero.
const listEmailsById = async () => {
  if (!supabaseAdmin) {
    return new Map<string, string>();
  }

  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });

  if (error) {
    throw error;
  }

  return new Map(data.users.map((user) => [user.id, user.email ?? ""]));
};

const getProfileById = async (id: string) => {
  const profile = await db.orm.public.Profiles.first({ id });

  if (!profile) {
    throw notFound("Usuario no encontrado");
  }

  return profile;
};

export const listUsuarios = async () => {
  const [profiles, emails] = await Promise.all([
    db.orm.public.Profiles.orderBy((profile) => profile.nombre.asc()).all(),
    listEmailsById(),
  ]);

  return profiles.map((profile) => ({ ...profile, email: emails.get(profile.id) ?? null }));
};

export const createUsuario = async (input: CreateUsuarioInput) => {
  const admin = requireAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    // El trigger trg_auth_usuario_creado crea el profile (rol OPERADOR) leyendo este nombre.
    user_metadata: { nombre: input.nombre },
  });

  if (error || !data.user) {
    if (error?.status === 422 || error?.code === "email_exists") {
      throw conflict("Ya existe un usuario con ese correo");
    }

    throw badRequest(error?.message ?? "No fue posible crear el usuario");
  }

  try {
    await db.orm.public.Profiles.where({ id: data.user.id }).update({
      nombre: varchar<150>(input.nombre),
      rol: input.rol,
      activo: true,
    });

    return { ...(await getProfileById(data.user.id)), email: data.user.email ?? input.email };
  } catch (profileError) {
    // Evita dejar una cuenta de Auth sin profile utilizable.
    await admin.auth.admin.deleteUser(data.user.id);
    throw profileError;
  }
};

// Un ban en Supabase Auth impide iniciar sesion; ~100 anios equivale a indefinido.
const BAN_INDEFINIDO = "876000h";

const syncAuthUser = async (id: string, input: UpdateUsuarioInput) => {
  if (input.email === undefined && input.activo === undefined) {
    return;
  }

  const admin = requireAdminClient();
  const { error } = await admin.auth.admin.updateUserById(id, {
    email: input.email,
    email_confirm: input.email === undefined ? undefined : true,
    ban_duration:
      input.activo === undefined ? undefined : input.activo ? "none" : BAN_INDEFINIDO,
  });

  if (error) {
    if (error.status === 422 || error.code === "email_exists") {
      throw conflict("Ya existe un usuario con ese correo");
    }

    throw badRequest(error.message);
  }
};

export const updateUsuario = async (id: string, input: UpdateUsuarioInput, actorId?: string) => {
  const existing = await getProfileById(id);

  if (id === actorId && (input.activo === false || (input.rol && input.rol !== existing.rol))) {
    throw badRequest("No puedes desactivar ni cambiar el rol de tu propia cuenta");
  }

  // Auth primero: si el correo esta repetido no se toca el profile.
  await syncAuthUser(id, input);

  await db.orm.public.Profiles.where({ id }).update({
    nombre: input.nombre === undefined ? undefined : varchar<150>(input.nombre),
    rol: input.rol,
    activo: input.activo,
  });

  return getProfileById(id);
};
