import { Hono } from 'hono';

export const episodes = new Hono()
  .get('/', (c) => c.json({ episodes: [] }))
  .get('/:id', (c) => c.json({ id: c.req.param('id'), status: 'placeholder' }));
