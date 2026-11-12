// Central runtime configuration.
const isProduction = process.env.NODE_ENV === 'production';

const config = {
  isProduction,
  port: Number(process.env.PORT) || 3000,
  adminToken: process.env.ADMIN_TOKEN || (isProduction ? null : 'local-dev-token'),
};

if (isProduction && !config.adminToken) {
  throw new Error('ADMIN_TOKEN must be set when NODE_ENV=production');
}

module.exports = config;
