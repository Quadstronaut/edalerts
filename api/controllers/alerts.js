const Alert = require('../schema/Alert')
const commodities = require('../commodities.json')
const rareCommodities = require('../rarecommodities.json')

module.exports = {
  create: async (req, res) => {
    if (
      req.body.commodity &&
      req.body.type &&
      req.body.trigger &&
      req.body.value &&
      req.body.value > 0 &&
      ((req.body.type === 'sell' && req.body.minDemand) ||
        (req.body.type === 'buy' && req.body.minSupply)) &&
      req.body.pad &&
      typeof req.body.includePlanetary === 'boolean' &&
      typeof req.body.includeFleetCarrier === 'boolean' &&
      req.body.webhook &&
      (req.body.webhook.startsWith('https://discordapp.com/api/webhooks/') ||
        req.body.webhook.startsWith('https://discord.com/api/webhooks/')) &&
      req.body.freq
    ) {
      try {
        const newAlert = new Alert({
          ...req.body,
          lastSent: 0,
          created: Date.now(),
        })
        await newAlert.save()

        const [commodity] = commodities
          .concat(rareCommodities)
          .filter(
            (com) =>
              com.symbol.toLowerCase() === req.body.commodity.toLowerCase()
          )

        const freq = parseInt(req.body.freq)
        const message = `Alert created successfully: ${
          commodity ? commodity.name : req.body.commodity
        } ${req.body.type} ${req.body.trigger === 'above' ? '>' : '<'} ${
          req.body.value
        }. Minimum ${req.body.type === 'sell' ? 'demand' : 'supply'} ${
          req.body.type === 'sell' ? req.body.minDemand : req.body.minSupply
        }. ${
          req.body.pad === 'l'
            ? 'Large landing pad only'
            : 'Any landing pad size'
        }. Will send alerts ${
          freq === 0 ? 'as they happen' : `at most every ${freq / 1000} seconds`
        }.

Click here to delete: ${process.env.SITE_URL}/delete/${newAlert._id}`

        const webhookRes = await fetch(req.body.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000),
          body: JSON.stringify({
            username: 'ED Alerts',
            avatar_url: `${process.env.SITE_URL}/favicon.png`,
            content: message,
          }),
        })

        if (!webhookRes.ok) {
          const body = await webhookRes.json().catch(() => ({}))
          throw new Error(body?.message || `Webhook returned ${webhookRes.status}`)
        }

        res.send(newAlert._id)
      } catch (err) {
        res.status(500).send(err.message)
      }
    } else {
      res.sendStatus(400)
    }
  },
  get: async (req, res) => {
    try {
      const alert = await Alert.findOne({ _id: req.params.id })
      if (alert) {
        res.send(alert)
      } else {
        res.sendStatus(404)
      }
    } catch (err) {
      res.status(500).send(err.message)
    }
  },
  getByWebhook: async (req, res) => {
    try {
      const alerts = await Alert.find({ webhook: req.params.webhook })
      res.send(alerts || [])
    } catch (err) {
      res.status(500).send(err.message)
    }
  },
  delete: async (req, res) => {
    try {
      const del = await Alert.deleteOne({ _id: req.params.id })
      if (del.deletedCount > 0) {
        res.sendStatus(200)
      } else {
        res.sendStatus(404)
      }
    } catch (err) {
      res.status(500).send(err.message)
    }
  },
  count: async (req, res) => {
    try {
      const alertCount = await Alert.countDocuments({})
      res.send({ count: alertCount })
    } catch (err) {
      res.status(500).send(err.message)
    }
  },
}
