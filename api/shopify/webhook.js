// File: api/shopify/webhook.js

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Only POST requests allowed')
  }

  const rawBody = await getRawBody(req)
  const hmac = req.headers['x-shopify-hmac-sha256']

  const digest = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(rawBody)
    .digest('base64')

  if (digest !== hmac) {
    console.warn('⚠️ Invalid HMAC signature')
    return res.status(401).send('Invalid signature')
  }

  const body = JSON.parse(rawBody)
  console.log('✅ Webhook received:', body)

  const customerEmail = body.email || body.customer?.email
  const productTitle = body.line_items?.[0]?.title || 'Desconocido'

  // Find Supabase user by email
  const { data: user, error: userError } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', customerEmail)
    .single()

  if (userError || !user) {
    console.error('❌ User not found for email:', customerEmail)
    return res.status(404).send('User not found')
  }

  // Identify automation based on product name
  const automation_slug = identifyAutomation(productTitle)

  const { error: upsertError } = await supabase.from('subscriptions').upsert({
    user_id: user.id,
    automation_slug,
    plan_name: productTitle,
    status: 'active',
    started_at: new Date(),
    shopify_order_id: body.id?.toString()
  }, {
    onConflict: ['user_id', 'automation_slug']
  })

  if (upsertError) {
    console.error('❌ Error saving subscription:', upsertError)
    return res.status(500).send('Database error')
  }

  return res.status(200).send('Subscription saved')
}

function identifyAutomation(productTitle) {
  const lower = productTitle.toLowerCase()
  if (lower.includes('calendar')) return 'calendar_agent'
  if (lower.includes('rebeq')) return 'rebeq'
  if (lower.includes('vera')) return 'vera'
  return 'unknown'
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => (data += chunk))
    req.on('end', () => resolve(Buffer.from(data)))
    req.on('error', reject)
  })
}

export const config = {
  api: {
    bodyParser: false,
  },
}
