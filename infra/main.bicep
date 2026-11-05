param location string = resourceGroup().location
param appName string
param storageName string
param pubsubName string
@allowed(['Free_F1', 'Standard_S1'])
param pubsubSku string = 'Free_F1'
@secure()
@minLength(32)
param sessionSecret string

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: { supportsHttpsTrafficOnly: true, minimumTlsVersion: 'TLS1_2', allowBlobPublicAccess: false }
}
resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [{
        name: 'expire-game-state'
        enabled: true
        type: 'Lifecycle'
        definition: {
          filters: { blobTypes: ['blockBlob'], prefixMatch: ['game-state/'] }
          actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 3 } } }
        }
      }]
    }
  }
}
resource pubsub 'Microsoft.SignalRService/webPubSub@2024-03-01' = {
  name: pubsubName
  location: location
  sku: { name: pubsubSku, tier: pubsubSku == 'Free_F1' ? 'Free' : 'Standard', capacity: 1 }
  properties: { publicNetworkAccess: 'Enabled', tls: { clientCertEnabled: false } }
}
resource app 'Microsoft.Web/staticSites@2023-12-01' = {
  name: appName
  location: location
  sku: { name: 'Free', tier: 'Free' }
  properties: { stagingEnvironmentPolicy: 'Enabled', allowConfigFileUpdates: true }
}
resource settings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: app
  name: 'appsettings'
  properties: {
    SESSION_SECRET: sessionSecret
    GAME_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
    WEB_PUBSUB_CONNECTION_STRING: pubsub.listKeys().primaryConnectionString
  }
}
output appUrl string = 'https://${app.properties.defaultHostname}'
output staticWebAppName string = app.name
