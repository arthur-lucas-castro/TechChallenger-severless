const auth = require('./handlers/auth');
const refresh = require('./handlers/refresh');

// Uma única Lambda atende as rotas de autenticação (docs/auth-flow.md, seção 1).
const routes = {
  'POST /auth': auth.handler,
  'POST /auth/refresh': refresh.handler,
};

exports.handler = async (event, context) => {
  const route = routes[event.routeKey];
  if (!route) {
    return { statusCode: 404, body: '' };
  }
  return route(event, context);
};
