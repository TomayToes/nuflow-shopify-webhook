import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const config = {
  api: {
    bodyParser: false,
  },
}

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
    console.warn('❌ Invalid HMAC')
    return res.status(401).send('Invalid signature')
  }

  const body = JSON.parse(rawBody)
  console.log('✅ Webhook received', body)

  const email = body.email || body.customer?.email
  const title = body.line_items?.[0]?.title || 'unknown'

  const { data: user, error: userError } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single()

  if (!user || userError) {
    console.error('❌ Supabase user not found:', email)
    return res.status(404).send('User not found')
  }

  const automation_slug = detectAutomation(title)

  const { error: subError } = await supabase.from('subscriptions').upsert({
    user_id: user.id,
    automation_slug,
    plan_name: title,
    status: 'active',
    started_at: new Date(),
    shopify_order_id: body.id?.toString()
  }, { onConflict: ['user_id', 'automation_slug'] })

  if (subError) {
    console.error('❌ Supabase upsert error', subError)
    return res.status(500).send('DB error')
  }

  return res.status(200).send('Subscription recorded')
}

function detectAutomation(title) {
  const t = title.toLowerCase()
  if (t.includes('calendar')) return 'calendar_agent'
  if (t.includes('vera')) return 'vera'
  if (t.includes('rebeq')) return 'rebeq'
  return 'unknown'
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => (data += chunk))
    req.on('end', () => resolve(Buffer.from(data)))
    req.on('error', reject)
  })
}
