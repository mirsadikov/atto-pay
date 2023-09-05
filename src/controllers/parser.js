const data = require('../../data/tariffs_response_example.json')
const tariffs = require('../../data/tariffs.json')

function parseResponse(req, res) {
  const allTariffs = JSON.stringify(
    Object.values(tariffs).reduce((acc, tariff) => {
      if (!acc[tariff.name]) acc[tariff.name] = {}
      acc[tariff.name][tariff.days] = 0
      return acc
    }, {})
  )

  const iterate = (data) => {
    let output = {}

    if (data[0].objectType == 'Merchant') {
      data.forEach((merchant) => {
        output[merchant.objectParam] = iterate(merchant.eventCountSet)
      })
    }

    if (data[0].objectType == 'Service') {
      data.forEach((service) => {
        output[service.objectName] = iterate(service.eventCountSet)
      })
    }

    if (data[0].objectType == 'ServicePoint') {
      data.forEach((servicePoint) => {
        output[servicePoint.objectName] = iterate(servicePoint.eventCountSet)
      })
    }

    if (data[0].objectType == 'Fare') {
      // deep copy of allTariffs to output
      output = JSON.parse(allTariffs)

      data.forEach((fare) => {
        const fareName = tariffs[fare.objectId] ? tariffs[fare.objectId].name : fare.objectParam
        const fareDay = tariffs[fare.objectId] ? tariffs[fare.objectId].days : 'Monthly'

        // если базовый тариф, то пропускаем
        if (fareName === 'Базовый') return

        if (!output[fareName]) {
          output[fareName] = {
            5: 0,
            10: 0,
            15: 0,
            20: 0,
            30: 0,
            Monthly: 0,
          }
        }

        output[fareName][fareDay] += fare.passCount
      })
    }

    return output
  }

  const result = iterate(data.eventCountSet)
  const metro = result.metro
  delete result.metro

  const response = {
    metro,
    bus: {
      ...result,
    },
  }

  res.json(response)
}

module.exports = {
  parseResponse,
}
