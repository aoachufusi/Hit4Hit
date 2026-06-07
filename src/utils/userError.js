/** Safe message for toasts, UI, and API responses — never expose internals. */
export const GENERIC_USER_ERROR = "Something went wrong — please try again";

export function logClientError(context, error) {
  console.error(context, error);
}
