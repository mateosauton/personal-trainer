export type AppEnvironment = 'development' | 'preview' | 'production' | 'local' | 'mock';
export type ValidationPurpose = 'development' | 'test' | 'distribution' | 'runtime';
export interface EnvironmentInput {
  appEnvironment: string | undefined;
  url: string | undefined;
  key: string | undefined;
  purpose: ValidationPurpose;
  allowMock?: boolean;
  allowLocal?: boolean;
  devLoginEmail?: string;
  devLoginPassword?: string;
  allowDevLogin?: string;
}
export interface EnvironmentConfig {
  appEnvironment: AppEnvironment;
  projectRef: string | null;
  url: string;
  key: string;
}
export type EnvironmentRegistry = Record<'development' | 'preview' | 'production', { projectRef: string | null }>;
export function validateEnvironment(input: EnvironmentInput, registry?: EnvironmentRegistry): EnvironmentConfig;
export function validateProcessEnvironment(env: Record<string, string | undefined>, options: { purpose: ValidationPurpose; expectedEnvironment?: string; allowMock?: boolean; allowLocal?: boolean }, registry?: EnvironmentRegistry): EnvironmentConfig;
export const MOCK_URL: string;
export const MOCK_KEY: string;
export const EAS_PROFILE_ENVIRONMENTS: Readonly<Record<string, string>>;
export function resolveCommandContext(argv: string[]): { readOnly: true } | { purpose: ValidationPurpose; expectedEnvironment?: string; allowLocal?: boolean; allowMock?: boolean };
