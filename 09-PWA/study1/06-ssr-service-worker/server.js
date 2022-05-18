/**
 * @file render server
 * @author *__ author __*{% if: *__ email __* %}(*__ email __*){% /if %}
 */

const fs = require('fs')
const path = require('path')
const lruCache = require('lru-cache')
const express = require('express')
const favicon = require('serve-favicon')
const compression = require('compression')
const resolve = file => path.resolve(__dirname, file)
const vueServerRenderer = require('vue-server-renderer')
const createBundleRenderer = vueServerRenderer.createBundleRenderer

const isProd = process.env.NODE_ENV === 'production'
const useMicroCache = process.env.MICRO_CACHE !== 'false'
const serverInfo = ''
  + 'express/' + require('express/package.json').version
  + 'vue-server-renderer/' + require('vue-server-renderer/package.json').version

const app = express()

const template = fs.readFileSync(resolve('./src/index.template.html'), 'utf-8')

function createRenderer(bundle, options) {

  // https://github.com/vuejs/vue/blob/dev/packages/vue-server-renderer/README.md#why-use-bundlerenderer
  return createBundleRenderer(bundle, Object.assign(options, {
    template,

    // for component caching
    cache: lruCache({
      max: 1000,
      maxAge: 1000 * 60 * 15
    }),

    // this is only needed when vue-server-renderer is npm-linked
    basedir: resolve('./dist'),

    // recommended for performance
    runInNewContext: false
  }))
}

let renderer
let readyPromise

if (isProd) {

  // In production: create server renderer using built server bundle.
  // The server bundle is generated by vue-ssr-webpack-plugin.
  const bundle = require('./dist/vue-ssr-server-bundle.json')

  // The client manifests are optional, but it allows the renderer
  // to automatically infer preload/prefetch links and directly add <script>
  // tags for any async chunks used during render, avoiding waterfall requests.
  const clientManifest = require('./dist/vue-ssr-client-manifest.json')

  renderer = createRenderer(bundle, {
    clientManifest
  })
}
else {

  // In development: setup the dev server with watch and hot-reload,
  // and create a new renderer on bundle / index template update.
  readyPromise = require('./build/setup-dev-server')(app, (bundle, options) => {
    renderer = createRenderer(bundle, options)
  })
}

let serve = (path, cache) => express.static(resolve(path), {
  maxAge: cache && isProd ? 1000 * 60 * 60 * 24 * 30 : 0
})

app.use(compression({ threshold: 0 }))
app.use(favicon('./static/favicon-32x32.png'))
// app.use('/static', serve('./static', true))
app.use('/dist', serve('./dist', true))
// app.use('/manifest.json', serve('./static/manifest.json', true))
app.use('/sw.js', serve('./static/sw.js'))

// 1-second microcache.
// https://www.nginx.com/blog/benefits-of-microcaching-nginx/
let microCache = lruCache({
  max: 100,
  maxAge: 1000
})

// since this app has no user-specific content, every page is micro-cacheable.
// if your app involves user-specific content, you need to implement custom
// logic to determine whether a request is cacheable based on its url and
// headers.
const isCacheable = req => useMicroCache

function render(req, res) {
  let s = Date.now()

  res.setHeader('Content-Type', 'text/html')
  res.setHeader('Server', serverInfo)

  let handleError = err => {
    if (err.url) {
      res.redirect(err.url)
    }
    else if (err.code === 404) {
      res.status(404).end('404 | Page Not Found')
    }
    else {
      // Render Error Page or Redirect
      res.status(500).end('500 | Internal Server Error')
      console.error(`error during render : ${req.url}`)
      console.error(err.stack)
    }
  }

  let cacheable = isCacheable(req)

  if (cacheable) {
    let hit = microCache.get(req.url)

    if (hit) {
      if (!isProd) {
        console.log('cache hit!')
      }
      return res.end(hit)
    }
  }

  let context = {
    title: 'Lavas', // default title
    url: req.url
  }
  console.log(context)
  renderer.renderToString(context, (err, html) => {
    if (err) {
      return handleError(err)
    }
    res.end(html)
    if (cacheable) {
      microCache.set(req.url, html)
    }
    if (!isProd) {
      console.log(`whole request: ${Date.now() - s}ms`)
    }
  })
}

app.get('*', isProd ? render : (req, res) => {
  console.log(req.url)
  readyPromise.then(() => render(req, res))
})

let port = process.env.PORT || 8080
app.listen(port, () => {
  console.log('server started at localhost:' + port)
})
