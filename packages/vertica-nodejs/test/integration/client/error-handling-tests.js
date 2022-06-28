'use strict'

var helper = require('./test-helper')
var util = require('util')

var vertica = helper.vertica
const Client = vertica.Client
const DatabaseError = vertica.DatabaseError

var createErrorClient = async function () {
  var client = await helper.client()
  client.once('error', function (err) {
    assert.fail('Client shoud not throw error during query execution')
  })
  client.on('drain', client.end.bind(client))
  return client
}

const suite = new helper.Suite('error handling')

suite.test('sending non-array argument as values causes an error callback', (done) => {
  const client = new Client()
  client.connect((err) => {
    if (err) {
      return done(err)
    }
    client.query('select ?::varchar as name', 'foo', (err) => {
      assert(err instanceof Error)
      client.query('SELECT ?::varchar as name', ['foo'], (err, res) => {
        assert.equal(res.rows[0].name, 'foo')
        client.end(done)
      })
    })
  })
})

suite.test('re-using connections results in error callback', (done) => {
  const client = new Client()
  client.connect((err) => {
    if (err) {
      return done(err)
    }
    client.connect((err) => {
      assert(err instanceof Error)
      client.end(done)
    })
  })
})

suite.testAsync('re-using connections results in promise rejection', () => {
  const client = new Client()
  return client.connect().then(() => {
    return helper.rejection(client.connect()).then((err) => {
      assert(err instanceof Error)
      return client.end()
    })
  })
})

suite.test('using a client after closing it results in error', (done) => {
  const client = new Client()
  client.connect((err) => {
    if (err) {
      return done(err)
    }
    client.end(
      assert.calls(() => {
        client.query(
          'SELECT 1',
          assert.calls((err) => {
            assert.equal(err.message, 'Client was closed and is not queryable')
            done()
          })
        )
      })
    )
  })
})

suite.test('query receives error on client shutdown', function (done) {
  var client = new Client()
  client.connect(
    assert.success(function () {
      const config = {
        text: 'select sleep(5)',
        name: 'foobar',
      }
      let queryError
      client.query(
        new vertica.Query(config),
        assert.calls(function (err, res) {
          assert(err instanceof Error)
          queryError = err
        })
      )
      setTimeout(() => client.end(), 50)
      client.once('end', () => {
        assert(queryError instanceof Error)
        done()
      })
    })
  )
})

var ensureFuture = async function (testClient, done) {
  testClient.on('drain', testClient.end.bind(testClient))
  console.log("in ensureFuture")
  var goodQuery = await testClient.query(new vertica.Query('select age from boom'))
  console.log("sent simple query")
  assert.emits(goodQuery, 'row', function (row) {
    console.log("before assert")
    assert.equal(row.age, 28)
    console.log("done soon")
    done()
    
  })
}

suite.test('when query is parsing', async (done) => {
  var client = await helper.client()
  //var client = await createErrorClient()

  var q = await client.query({ text: 'CREATE LOCAL TEMP TABLE boom(age integer); INSERT INTO boom (age) VALUES (28);' })

  // this query wont parse since there isn't a table named bang
  var query = await client.query(
    new vertica.Query({
      text: 'select * from bang where name = ?',
      values: ['0'],
    })
  )

  assert.emits(query, 'error', async function (err) {
    console.log("in error emit")
    //query.on('readyForQuery', async () => ensureFuture(client, done))
    ensureFuture(client, done)
  })
})

suite.test('when a query is binding', async function (done) {
  var client = await createErrorClient()

  var q = await client.query({ text: 'CREATE LOCAL TEMP TABLE boom(age integer); INSERT INTO boom (age) VALUES (28);' })

  var query = await client.query(
    new vertica.Query({
      text: 'select * from boom where age = ?',
      values: ['asldkfjasdf'],
    })
  )

  assert.emits(query, 'error', function (err) {
    if (!helper.config.native) {
      assert(err instanceof DatabaseError)
    }
    assert.equal(err.severity, 'ERROR')
    ensureFuture(client, done)
  })
})

suite.test('non-query error with callback', function (done) {
  var client = new Client({
    user: 'asldkfjsadlfkj',
  })
  client.connect(
    assert.calls(function (error, client) {
      assert(error instanceof Error)
      done()
    })
  )
})

suite.test('non-error calls supplied callback', function (done) {
  var client = new Client({
    user: helper.args.user,
    password: helper.args.password,
    host: helper.args.host,
    port: helper.args.port,
    database: helper.args.database,
  })

  client.connect(
    assert.calls(function (err) {
      assert.ifError(err)
      client.end(done)
    })
  )
})

suite.test('when connecting to an invalid host with callback', function (done) {
  var client = new Client({
    user: 'very invalid username',
  })
  client.on('error', () => {
    assert.fail('unexpected error event when connecting')
  })
  client.connect(function (error, client) {
    assert(error instanceof Error)
    done()
  })
})

suite.test('when connecting to invalid host with promise', function (done) {
  var client = new Client({
    user: 'very invalid username',
  })
  client.on('error', () => {
    assert.fail('unexpected error event when connecting')
  })
  client.connect().catch((e) => done())
})

suite.test('non-query error', function (done) {
  var client = new Client({
    user: 'asldkfjsadlfkj',
  })
  client.connect().catch((e) => {
    assert(e instanceof Error)
    done()
  })
})

suite.test('within a simple query', (done) => {
  var client = createErrorClient()

  var query = client.query(new vertica.Query("select eeeee from yodas_dsflsd where pixistix = 'zoiks!!!'"))

  assert.emits(query, 'error', function (error) {
    if (!helper.config.native) {
      assert(error instanceof DatabaseError)
    }
    assert.equal(error.severity, 'ERROR')
    done()
  })
})

suite.test('connected, idle client error', (done) => {
  const client = new Client()
  client.connect((err) => {
    if (err) {
      throw new Error('Should not receive error callback after connection')
    }
    setImmediate(() => {
      ;(client.connection || client.native).emit('error', new Error('expected'))
    })
  })
  client.on('error', (err) => {
    assert.equal(err.message, 'expected')
    client.end(done)
  })
})

suite.test('cannot pass non-string values to query as text', (done) => {
  const client = new Client()
  client.connect((err) => {
    if (err) {
      return done(err)
    }
    client.query({ text: {} }, (err) => {
      assert(err)
      client.query({}, (err) => {
        client.on('drain', () => {
          client.end(done)
        })
      })
    })
  })
})
