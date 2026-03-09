import axios from 'axios'

async function run() {
  const token = 'y0__xCb7t-8BxjZ_D0ghLC70BbZksxH0qgEic35jCM7wznNDU39pQ'
  try {
    const res = await axios.post(
      'https://api.direct.yandex.com/json/v5/campaigns',
      {
        method: 'get',
        params: { SelectionCriteria: {}, FieldNames: ['Id'], Page: { Limit: 1, Offset: 0 } },
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept-Language': 'ru',
        },
      }
    )
    console.log('SUCCESS:', res.data)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('ERROR STATUS:', err.response?.status)
    console.error('ERROR DATA:', err.response?.data)
    console.error('ERROR MESSAGE:', err.message)
    console.error('ERROR CODE:', err.code)
    if (err.response?.headers) {
      console.error('HEADERS:', err.response.headers)
    }
  }
}

run()
