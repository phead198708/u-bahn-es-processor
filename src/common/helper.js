/**
 * Contains generic helper methods
 */

const AWS = require('aws-sdk')
const config = require('config')
const elasticsearch = require('elasticsearch')
const _ = require('lodash')
const Joi = require('@hapi/joi')
const { Mutex } = require('async-mutex')

AWS.config.region = config.ES.AWS_REGION

// Elasticsearch client
let esClient
// Mutex to ensure that only one elasticsearch action is carried out at any given time
const esClientMutex = new Mutex()

/**
 * Get Kafka options
 * @return {Object} the Kafka options
 */
function getKafkaOptions () {
  const options = { connectionString: config.KAFKA_URL, groupId: config.KAFKA_GROUP_ID }
  if (config.KAFKA_CLIENT_CERT && config.KAFKA_CLIENT_CERT_KEY) {
    options.ssl = { cert: config.KAFKA_CLIENT_CERT, key: config.KAFKA_CLIENT_CERT_KEY }
  }
  return options
}

/**
 * Get ES Client
 * @return {Object} Elasticsearch Client Instance
 */
async function getESClient () {
  if (esClient) {
    return esClient
  }
  const host = config.ES.HOST
  const apiVersion = config.ES.API_VERSION

  // AWS ES configuration is different from other providers
  if (/.*amazonaws.*/.test(host)) {
    try {
      esClient = new elasticsearch.Client({
        apiVersion,
        host,
        connectionClass: require('http-aws-es') // eslint-disable-line global-require
      })
    } catch (error) { console.log(error) }
  } else {
    esClient = new elasticsearch.Client({
      apiVersion,
      host
    })
  }

  // Patch the transport to enable mutex
  esClient.transport.originalRequest = esClient.transport.request
  esClient.transport.request = async (params) => {
    const release = await esClientMutex.acquire()
    try {
      return await esClient.transport.originalRequest(params)
    } finally {
      release()
    }
  }

  return esClient
}

/**
 * Function to valid require keys
 * @param {Object} payload validated object
 * @param {Array} keys required keys
 * @throws {Error} if required key absent
 */
function validProperties (payload, keys) {
  const schema = Joi.object(_.fromPairs(_.map(keys, key => [key, Joi.string().uuid().required()]))).unknown(true)
  const error = schema.validate(payload).error
  if (error) {
    throw error
  }
}

/**
 * Function to get user from es
 * @param {String} userId
 * @returns {Object} user
 */
async function getUser (userId) {
  const client = await getESClient()
  return client.getSource({ index: config.get('ES.USER_INDEX'), type: config.get('ES.USER_TYPE'), id: userId })
}

/**
 * Function to update es user
 * @param {String} userId
 * @param {Object} body
 */
async function updateUser (userId, body) {
  const client = await getESClient()
  await client.update({
    index: config.get('ES.USER_INDEX'),
    type: config.get('ES.USER_TYPE'),
    id: userId,
    body: { doc: body }
  })
}

/**
 * Function to get org from es
 * @param {String} organizationId
 * @returns {Object} organization
 */
async function getOrg (organizationId) {
  const client = await getESClient()
  return client.getSource({ index: config.get('ES.ORGANIZATION_INDEX'), type: config.get('ES.ORGANIZATION_TYPE'), id: organizationId })
}

/**
 * Function to update es organization
 * @param {String} organizationId
 * @param {Object} body
 */
async function updateOrg (organizationId, body) {
  const client = await getESClient()
  await client.update({
    index: config.get('ES.ORGANIZATION_INDEX'),
    type: config.get('ES.ORGANIZATION_TYPE'),
    id: organizationId,
    body: { doc: body }
  })
}

/**
 * Fuction to get an Error with statusCode property
 * @param {String} message error message
 * @param {Number} statusCode
 * @returns {Error} an Error with statusCode property
 */
function getErrorWithStatus (message, statusCode) {
  const error = Error(message)
  error.statusCode = statusCode
  return error
}

module.exports = {
  getKafkaOptions,
  getESClient,
  validProperties,
  getUser,
  updateUser,
  getOrg,
  updateOrg,
  getErrorWithStatus
}
