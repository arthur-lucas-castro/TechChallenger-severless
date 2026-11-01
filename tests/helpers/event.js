function httpEvent(routeKey, body, overrides = {}) {
  return {
    routeKey,
    requestContext: { requestId: 'req-teste' },
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    ...overrides,
  };
}

const lambdaContext = { awsRequestId: 'aws-req-teste' };

module.exports = { httpEvent, lambdaContext };
