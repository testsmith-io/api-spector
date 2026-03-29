// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import type { Collection, Environment } from '../../shared/types';

export const REQUEST_ID_1 = 'req-get-users';
export const REQUEST_ID_2 = 'req-create-user';
export const REQUEST_ID_3 = 'req-delete-user';

export function makeCollection(): Collection {
  return {
    version: '1.0',
    id: 'col-1',
    name: 'User API',
    description: 'User management endpoints',
    rootFolder: {
      id: 'root',
      name: 'root',
      description: '',
      folders: [
        {
          id: 'folder-users',
          name: 'Users',
          description: '',
          folders: [],
          requestIds: [REQUEST_ID_1, REQUEST_ID_2, REQUEST_ID_3],
        },
      ],
      requestIds: [],
    },
    requests: {
      [REQUEST_ID_1]: {
        id: REQUEST_ID_1,
        name: 'Get Users',
        method: 'GET',
        url: '{{BASE_URL}}/users',
        headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
        params: [{ key: 'page', value: '1', enabled: true }],
        auth: { type: 'bearer', token: '{{AUTH_TOKEN}}' },
        body: { mode: 'none' },
      },
      [REQUEST_ID_2]: {
        id: REQUEST_ID_2,
        name: 'Create User',
        method: 'POST',
        url: '{{BASE_URL}}/users',
        headers: [],
        params: [],
        auth: { type: 'none' },
        body: { mode: 'json', json: '{"name":"{{USERNAME}}","email":"{{EMAIL}}"}' },
      },
      [REQUEST_ID_3]: {
        id: REQUEST_ID_3,
        name: 'Delete User',
        method: 'DELETE',
        url: '{{BASE_URL}}/users/{{USER_ID}}',
        headers: [],
        params: [],
        auth: { type: 'none' },
        body: { mode: 'none' },
      },
    },
  };
}

export function makeEnvironment(): Environment {
  return {
    version: '1.0',
    id: 'env-1',
    name: 'staging',
    variables: [
      { key: 'BASE_URL', value: 'https://api.staging.example.com', enabled: true },
      { key: 'AUTH_TOKEN', value: 'staging-token-123', enabled: true },
      { key: 'API_KEY', value: '', enabled: true, secret: true, secretEncrypted: 'enc', secretSalt: 'salt', secretIv: 'iv' },
    ],
  };
}
