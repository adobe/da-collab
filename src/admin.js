/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

export default async function adminFetch(docName, method, auth, env, body) {
  const { DAADMIN_API } = env;
  /* c8 ignore start */
  if (!DAADMIN_API) {
    throw new Error('DAADMIN_API is not set');
  }
  /* c8 ignore end */
  const headers = new Headers();
  headers.set('X-DA-Initiator', 'collab');
  if (auth) {
    if (Array.isArray(auth)) {
      headers.set('Authorization', [...new Set(auth)].join(','));
    } else {
      headers.set('Authorization', auth);
    }
  }

  // if docname is a full url, we need to extract the pathname
  let pathname = docName;
  if (docName.startsWith('https://')) {
    pathname = new URL(docName).pathname;
  }
  const url = new URL(pathname, DAADMIN_API);
  const opts = { method, headers };
  if (body) {
    opts.body = body;
  }
  // eslint-disable-next-line no-console
  console.log('da-collab fetches from da-admin', url.toString(), method);
  return fetch(url, opts);
}
