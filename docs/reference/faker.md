# Using Faker for Dynamic Test Data

[Faker.js](https://fakerjs.dev/) (`@faker-js/faker` v10) is available in all scripts as the global `faker` object. Use it in pre-request scripts to generate realistic, unique test data on every request.

## Basic usage

```js
// Pre-request script
sp.variables.set('email',    faker.internet.email())
sp.variables.set('username', faker.internet.username())
sp.variables.set('userId',   faker.string.uuid())
```

Then reference in the request body:

```json
{
  "email":    "{{email}}",
  "username": "{{username}}",
  "id":       "{{userId}}"
}
```

---

## Common categories

### Person

```js
faker.person.fullName()          // "Jane Smith"
faker.person.firstName()         // "Jane"
faker.person.lastName()          // "Smith"
faker.person.jobTitle()          // "Senior Developer"
faker.person.gender()            // "Female"
```

### Internet

```js
faker.internet.email()           // "jane.smith@example.com"
faker.internet.username()        // "jane_smith42"
faker.internet.password()        // "xK9#mLqP"
faker.internet.url()             // "https://example.com"
faker.internet.ip()              // "192.168.1.1"
faker.internet.userAgent()       // browser user-agent string
```

### String & ID

```js
faker.string.uuid()              // "550e8400-e29b-41d4-a716-446655440000"
faker.string.alphanumeric(10)    // "aB3xK9mLqP"
faker.string.numeric(6)          // "483921"
faker.number.int({ min: 1, max: 100 })   // 42
faker.number.float({ min: 0, max: 1, fractionDigits: 2 }) // 0.73
```

### Address / Location

```js
faker.location.streetAddress()   // "123 Main St"
faker.location.city()            // "Amsterdam"
faker.location.country()         // "Netherlands"
faker.location.countryCode()     // "NL"
faker.location.zipCode()         // "1234 AB"
faker.location.latitude()        // 52.3676
faker.location.longitude()       // 4.9041
```

### Company

```js
faker.company.name()             // "Acme Corp"
faker.company.catchPhrase()      // "Streamlined mobile solution"
faker.company.buzzPhrase()       // "leverage agile frameworks"
```

### Date & Time

```js
faker.date.recent()              // Date object — last 7 days
faker.date.past()                // Date object — last year
faker.date.future()              // Date object — next year
faker.date.between({ from: '2024-01-01', to: '2024-12-31' })
faker.date.birthdate({ min: 18, max: 65, mode: 'age' })
```

Combine with `dayjs` for formatting:

```js
const dob = dayjs(faker.date.birthdate({ min: 18, max: 65, mode: 'age' }))
sp.variables.set('birthdate', dob.format('YYYY-MM-DD'))
```

### Commerce / Finance

```js
faker.commerce.productName()     // "Fantastic Steel Chair"
faker.commerce.price()           // "42.99"
faker.finance.accountNumber()    // "12345678"
faker.finance.iban()             // "NL02ABNA0123456789"
faker.finance.currencyCode()     // "EUR"
faker.finance.amount()           // "1234.56"
```

### Lorem / Text

```js
faker.lorem.word()               // "ipsum"
faker.lorem.sentence()           // "Lorem ipsum dolor sit amet."
faker.lorem.paragraph()          // longer text block
faker.lorem.words(3)             // "lorem ipsum dolor"
```

---

## Recipes

### Create a user payload

```js
// Pre-request script
const user = {
  id:        faker.string.uuid(),
  firstName: faker.person.firstName(),
  lastName:  faker.person.lastName(),
  email:     faker.internet.email(),
  phone:     faker.phone.number(),
  address: {
    street:  faker.location.streetAddress(),
    city:    faker.location.city(),
    country: faker.location.countryCode(),
    zip:     faker.location.zipCode(),
  }
}

sp.variables.set('userPayload', JSON.stringify(user))
sp.variables.set('userId', user.id)
```

Use in a JSON body:

```json
{{userPayload}}
```

Or individual fields:

```json
{
  "firstName": "{{firstName}}",
  "email":     "{{email}}"
}
```

### Chain requests: create then verify

**Request 1: Create** (pre-request script):

```js
sp.variables.set('newEmail', faker.internet.email())
sp.variables.set('newName',  faker.person.fullName())
```

**Request 1: Create** (post-response script):

```js
const body = sp.response.json()
sp.collectionVariables.set('createdId', body.id)
```

**Request 2: Get** - use `{{createdId}}` in the URL:

```
GET {{BASE_URL}}/users/{{createdId}}
```

### Reproducible runs with a fixed seed

When debugging a failure you want to reproduce the exact same data:

```js
// Pre-request script
faker.seed(12345)
sp.variables.set('email', faker.internet.email())
```

Remove or comment out `faker.seed()` for random data in normal runs.

### Locale-specific data

```js
import { faker } from '@faker-js/faker'
// In scripts, set locale via:
faker.locale = 'nl'   // Dutch names, addresses, etc.

sp.variables.set('name',    faker.person.fullName())
sp.variables.set('city',    faker.location.city())
sp.variables.set('phone',   faker.phone.number())
```

Available locales include: `en`, `nl`, `de`, `fr`, `es`, `it`, `ja`, `zh_CN`, `pt_BR`, and [many more](https://fakerjs.dev/guide/localization.html).

---

## Available globals in scripts

| Global | Description |
|---|---|
| `faker` | Full `@faker-js/faker` instance |
| `dayjs` | Date manipulation; pairs well with `faker.date.*` |
| `sp.variables.set(key, val)` | Store generated value for use in the request |
| `sp.collectionVariables.set(key, val)` | Share generated value with other requests in the collection |
