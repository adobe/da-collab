# Document Authoring Collab

Document Authoring is a research project and collab is the collaboration backend of it.
It's implemented as a Cloudflare Worker using a Durable Object.

## Developing locally
### Run
To run da-collab locally da-admin also needs to be run locally. This is because da-collab uses a service binding
to communicate with da-admin. When run locally the service binding will be local as well.

To run da-admin locally see https://github.com/adobe/da-admin/blob/main/README.md

1. Clone this repo to your computer.
1. Run `npm install`
1. In a terminal, run `npm run dev` this repo's folder.
1. The da-collab service API is available via http://localhost:4711

#### Local backend testing override

For manual local testing, `IS_HELIX` in `.dev.vars` can force Helix at `api.aem.live` (`true`),
Helix at `localhost:3000` (`local`), or da-admin (`false`). Leave it unset for normal URL-based
backend selection. Forced URL rewriting and the `*** Calling` log are isolated in the
`getLocalTestBackendOverride()` helper.

#### Access via da-live

To access the locally running da-collab via da-live also running locally, first run da-live on your local machine
in addition to da-collab and da-admin. See here for instructions: https://github.com/adobe/da-live/blob/main/README.md

Then open a browser and access: http://localhost:3000/?da-admin=local&da-collab=local

### Run on stage
You can deploy da-collab on Cloudflare stage by merging into the `stage` branch.
Don't forget to deploy da-admin on stage as well, as otherwise you might be connecting to an old version.

To access da-collab and da-admin running on stage, open this URL in a browser: http://localhost:3000/?da-admin=stage&da-collab=stage

#### Notes
1. When passing in `?da-collab=local&da-admin=local` each service will set a localStorage value and will not clear until you use `?name-of-service=reset`. It is recommended to use an incognito browser window to ensure you don't forget about this setting.

## Additional details
### Helix backend polling
For Helix-backed documents, collab checks the backend ETag with a HEAD request every five seconds
while the session is connected. A changed ETag or a 404/410 response closes the session, cancels
pending local saves, and removes the stored restore anchor. Invalidation therefore does not
flush stale edits back to the backend, and reconnecting sessions reload the source document.
Ordinary connection closure and da-admin invalidation retain their existing save-flushing behavior.

Failed HEAD requests and successful responses without an ETag are logged and retried on the next
interval without disconnecting editors. Only one HEAD request is in flight per document, and
responses overlapping a local save or belonging to an old session are ignored. Polling starts
only if initialization finishes for the current, connected document. Destroying the document
clears its polling timer and aborts any pending HEAD request; late initialization cannot restart
polling after disconnect. The idle-but-connected session policy is unchanged.

### Recommendations
1. We recommend running `npm run lint` for linting.

## Dev Notes

### Handling diffs

There are two types of diff content, deleted and added.  Content is normally marked by `da-diff-deleted` or `da-diff-added` attributes on elements.  However for the special case of block groups, deleted content will be wrapped in a `da-diff-deleted` element that contains the block group.  The `da-diff-added` element is never used.
