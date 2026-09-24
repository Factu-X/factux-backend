import type { Numeric, Varchar } from "@prisma/orm-postgres/target/codec-types";

export const varchar = <Length extends number>(value: string) => value as Varchar<Length>;

export const optionalVarchar = <Length extends number>(value: string | undefined) =>
  value === undefined ? undefined : varchar<Length>(value);

export const nullableVarchar = <Length extends number>(value: string | null | undefined) =>
  value === undefined || value === null ? value : varchar<Length>(value);

export const numeric = <Precision extends number, Scale extends number>(value: number | string) =>
  value.toString() as Numeric<Precision, Scale>;
