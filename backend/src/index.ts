// Placeholder until the backend framework is set up; proves the shared packages resolve and typecheck.
import { brand } from '@zuvo/config';
import { type HealthResponse, isAllowedEmail, parseAllowedDomains } from '@zuvo/protocol';

export const serviceName: string = `${brand.name} API`;

export const isOrganizationEmail = (email: string): boolean =>
  isAllowedEmail(email, parseAllowedDomains(undefined));

export type { HealthResponse };
