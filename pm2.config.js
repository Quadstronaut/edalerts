module.exports = {
  apps: [
    {
      name: 'api',
      script: '/app/api/index.js',
      env: {
        PORT: 3001,
      },
    },
    {
      name: 'listener',
      script: '/app/api/listen.js',
    },
    {
      name: 'web',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: '/app/site',
      env: {
        PORT: 3000,
      },
    },
  ],
}
