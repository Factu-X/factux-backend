import type { RequestHandler } from "express";

import { supabase } from "../config/supabase.js";
import { db } from "../prisma/db.js";
import { forbidden, unauthorized } from "../shared/http-error.js";
import type { RolUsuario } from "../modules/auth/types.js";

const getBearerToken = (authorizationHeader: string | undefined) => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
};

// Cada consulta a la BD cuesta ~140 ms de red; el profile se guarda 30 s para no pagarlo en cada peticion.
// shortcut: cache en memoria de un solo proceso; si el backend escala a varias instancias, la
// desactivacion de un usuario tardaria hasta 30 s en las otras (usar Redis o bajar el TTL).
const PROFILE_TTL_MS = 30_000;
type CachedProfile = { id: string; nombre: string; rol: RolUsuario; activo: boolean };
const profileCache = new Map<string, { profile: CachedProfile; expires: number }>();

// usuarios.service la llama al editar un usuario para que el cambio de rol o activo sea inmediato.
export const invalidateProfileCache = (userId?: string) => {
  if (userId) profileCache.delete(userId);
  else profileCache.clear();
};

const findProfile = async (userId: string) => {
  const cached = profileCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.profile;

  const row = await db.orm.public.Profiles.first({ id: userId });
  if (!row) return null;

  const profile = { id: row.id, nombre: row.nombre, rol: row.rol, activo: row.activo };
  profileCache.set(userId, { profile, expires: Date.now() + PROFILE_TTL_MS });
  return profile;
};

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = getBearerToken(req.header("Authorization"));

    if (!token) {
      throw unauthorized();
    }

    // getClaims verifica la firma localmente con las llaves publicas del proyecto (JWKS en cache),
    // sin ir a Supabase en cada peticion. Desactivar un usuario sigue siendo inmediato: ver profile.activo.
    const { data, error } = await supabase.auth.getClaims(token);
    const userId = data?.claims.sub;

    if (error || !userId) {
      throw unauthorized("Token invalido o expirado");
    }

    const profile = await findProfile(userId);

    if (!profile) {
      throw unauthorized("El usuario autenticado no tiene profile asociado");
    }

    if (!profile.activo) {
      throw forbidden("El usuario esta inactivo");
    }

    req.user = {
      id: profile.id,
      nombre: profile.nombre,
      rol: profile.rol,
      activo: profile.activo,
    };

    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole =
  (...roles: RolUsuario[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) {
      next(unauthorized());
      return;
    }

    if (!roles.includes(req.user.rol)) {
      next(forbidden());
      return;
    }

    next();
  };
