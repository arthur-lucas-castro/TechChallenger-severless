const auth = require('./handlers/auth');
const logout = require('./handlers/logout');
const refresh = require('./handlers/refresh');
const { routeNotFound } = require('./utils/errors');
const { withHttp } = require('./utils/http');

// Uma única Lambda atende as rotas de autenticação (docs/auth-flow.md, seção 1).
const routes = {
  'POST /auth': auth.handler,
  'POST /auth/refresh': refresh.handler,
  'POST /auth/logout': logout.handler,
};

const unknownRoute = withHttp('DESCONHECIDA', async () => {
  throw routeNotFound();
});

exports.handler = async (event, context) => {
  const route = routes[event.routeKey] ?? unknownRoute;
  return route(event, context);
};
