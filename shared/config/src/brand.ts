/**
 * Single source of truth for the product brand.
 * The brand name, domains and colors must never be hard-coded anywhere else.
 */
export const brand = {
  name: 'Zuvo',
  tagline: 'Conversations that move work forward.',
  description:
    'Zuvo is the private, fast and secure messenger for the Correm Advisory team — on every device, right in your browser.',
  company: 'Correm Advisory India Pvt. Ltd.',
  domains: {
    organization: 'corremadvisory.com',
    landing: 'zuvo.corremadvisory.com',
    app: 'app.zuvo.corremadvisory.com',
    api: 'api.zuvo.corremadvisory.com',
    stagingApp: 'dev-app.zuvo.corremadvisory.com',
    stagingApi: 'dev-api.zuvo.corremadvisory.com',
  },
  supportEmail: 'support@corremadvisory.com',
  email: {
    /** Display name used in every outgoing email's "From" header. */
    senderName: 'Zuvo',
  },
  colors: {
    /** Deep indigo — primary brand color. */
    primary: '#4F46E5',
    /** Teal — brand accent color. */
    accent: '#14B8A6',
  },
} as const;

export type Brand = typeof brand;
