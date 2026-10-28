import ipaddr from 'ipaddr.js';

/** WHATWG URL keeps the brackets on an IPv6 literal; net.isIP and ipaddr do not accept them. */
export const unbracket = (host: string): string => host.replace(/^\[|\]$/g, '');

/**
 * ipaddr.js range of an IP literal, with ::ffff:a.b.c.d unwrapped to the IPv4 it carries.
 * Throws on a string that is not an IP.
 */
export const ipRange = (ip: string): string => ipaddr.process(ip).range();

/**
 * True when ipaddr.js classifies the address as plain `unicast`, meaning it is in none of its
 * special-range lists (loopback, private, CGNAT, link-local, reserved, 6to4, teredo, ...).
 * That is not a proof of global routability: a few unallocated blocks (e.g. IPv6 fec0::/10) fall
 * through as unicast too. Kept in its own file so the web bundle can import it without node:dns.
 */
export const isUnicast = (ip: string): boolean => ipRange(ip) === 'unicast';

export const isIpLiteral = (host: string): boolean => ipaddr.isValid(host);
