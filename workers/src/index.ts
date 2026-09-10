import { Hono } from 'hono'

const app = new Hono<{ Bindings: CloudflareBindings }>()

app.get('/', (c) => {
  return c.json({ hello: 'onenav-workers', hasDb: !!c.env.DB })
})

export default app
