interface ResponseWithCookies {
  cookies: Array<{ name: string; value: string }>;
}

export function getCookie(response: ResponseWithCookies, name: string): string | undefined {
  return response.cookies.find((cookie) => cookie.name === name)?.value;
}
