const HUB_NAMES = {
  KUL: 'Kuala Lumpur', PEN: 'Penang', JHB: 'Johor Bahru', IPH: 'Ipoh',
  MKZ: 'Melaka', SRB: 'Seremban', KUA: 'Kuantan', AOR: 'Alor Setar',
  KBR: 'Kota Bharu', TGG: 'Kuala Terengganu', KCH: 'Kuching', BKI: 'Kota Kinabalu'
};

export const hubName = hub => HUB_NAMES[hub.code] ?? hub.name;

export const SHIPMENT_STATES = {
  CREATED: 'Awaiting dispatch', ASSIGNED: 'Assigned', IN_TRANSIT: 'In transit',
  AT_TRANSFER: 'At transfer hub', ARRIVED_HUB: 'At destination hub',
  OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered',
  EXCEPTION: 'Delivery exception', CANCELLED: 'Cancelled'
};

export const EXCEPTION_REASONS = {
  '\u6536\u4ef6\u4eba\u4e0d\u5728': 'Recipient unavailable',
  '\u5730\u5740\u4e0d\u8be6': 'Incomplete address',
  '\u6536\u4ef6\u4eba\u62d2\u6536': 'Recipient refused delivery',
  '\u5305\u88f9\u5916\u7bb1\u7834\u635f': 'Damaged packaging',
  '\u7535\u8bdd\u65e0\u4eba\u63a5\u542c': 'No answer by phone'
};
