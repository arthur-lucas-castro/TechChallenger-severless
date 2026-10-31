module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.js'],
  coverageReporters: ['text', 'lcov'],
  // Com --coverage, ficar abaixo de qualquer um destes limites faz o comando falhar.
  coverageThreshold: {
    global: { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
};
