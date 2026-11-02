// Placeholder until the frontend framework is set up; proves the shared packages resolve and typecheck.
import { brand } from '@zuvo/config';
import { isAllowedEmail } from '@zuvo/protocol';
import { themes } from '@zuvo/ui-tokens';

export const appTitle: string = brand.name;
export const primaryColor: string = themes.light.colors.brand;
export { isAllowedEmail };
