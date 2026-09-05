import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './generated/database.types.js';

export type { Database, Json } from './generated/database.types.js';

/**
 * Seul le schéma `public` est exposé.
 *
 * Les types générés ne contiennent pas le schéma `private` : `pnpm db:types` ne
 * l'inclut jamais. Une table privée n'est donc même pas nommable depuis un
 * client applicatif, y compris avec une clé de service
 * (02_DATA_MODEL §25, 01_ARCHITECTURE §9).
 */
export type PublicSchema = Database['public'];

export type Tables = PublicSchema['Tables'];
export type TableName = keyof Tables & string;

export type Row<TTable extends TableName> = Tables[TTable]['Row'];
export type InsertRow<TTable extends TableName> = Tables[TTable]['Insert'];
export type UpdateRow<TTable extends TableName> = Tables[TTable]['Update'];

export type ColumnName<TTable extends TableName> = keyof Row<TTable> & string;

export type EnumName = keyof PublicSchema['Enums'] & string;
export type Enum<TEnum extends EnumName> = PublicSchema['Enums'][TEnum];

/** Client Supabase typé sur le schéma PLUKA. */
export type PlukaClient = SupabaseClient<Database, 'public'>;
