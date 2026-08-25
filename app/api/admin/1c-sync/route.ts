import { NextResponse } from 'next/server';
import axios from 'axios';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  let reqUrl = '';
  
  try {
    const body = await req.json().catch(() => ({}));
    if (body.url) reqUrl = body.url.trim();
  } catch (e) {}

  if (!reqUrl) {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: '1C_HTTP_URL' }
    }).catch(() => null);
    
    if (setting?.value) {
      reqUrl = setting.value.trim();
    }
  }

  if (!reqUrl) {
    reqUrl = 'https://wreath-paddling-precook.ngrok-free.dev/Bozorcham/hs/Bozorcham/GetTovarList';
  }

  // Ensure full endpoint URL
  if (!reqUrl.includes('/hs/Bozorcham/GetTovarList')) {
    reqUrl = reqUrl.replace(/\/+$/, '') + '/Bozorcham/hs/Bozorcham/GetTovarList';
  }

  const basicAuthHeader = 'Basic ' + Buffer.from('mobiles:123').toString('base64');

  let items: any[] = [];
  let fetchErrorDetails = '';

  try {
    const response = await axios.get(reqUrl, {
      headers: {
        'Authorization': basicAuthHeader,
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json, text/plain, */*'
      },
      timeout: 20000
    });

    let resBody = response.data;
    if (typeof resBody === 'string') {
      try { resBody = JSON.parse(resBody); } catch (e) {}
    }

    if (Array.isArray(resBody)) {
      items = resBody;
    } else if (resBody && typeof resBody === 'object') {
      items = resBody.data || resBody.items || resBody.products || resBody.result || resBody.tovarlar || [];
    }
  } catch (err: any) {
    fetchErrorDetails = err.response?.data 
      ? (typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data))
      : (err.message || '1C serveriga ulanib bo\'lmadi');
    console.error('[1C SYNC FETCH ERROR]:', fetchErrorDetails);
  }

  if (fetchErrorDetails && items.length === 0) {
    return NextResponse.json({
      success: false,
      message: `1C bilan ulanishda xatolik: ${fetchErrorDetails}`
    }, { status: 400 });
  }

  try {
    let category = await prisma.category.findFirst({
      where: { OR: [{ slug: 'kategoriyasiz' }, { name: 'Kategoriyasiz' }] }
    });

    if (!category) {
      category = await prisma.category.create({
        data: { name: 'Kategoriyasiz', slug: 'slug-kategoriyasiz' } // safe slug
      });
    }

    let savedCount = 0;
    for (const item of items) {
      const sku = String(item.id || item.sku || item.code || item.barcode || '').trim();
      const name = String(item.name || item.title || item.naimenovanie || '').trim();
      const priceStr = String(item.price || item.cena || '0').replace(/\s+/g, '').replace(',', '.');
      const price = parseFloat(priceStr) || 0;
      const stock = parseInt(String(item.quantity || item.ostatok || 0)) || 0;
      const barcode = item.barcode ? String(item.barcode).trim() : null;

      if (!sku || !name) continue;

      await prisma.product.upsert({
        where: { sku },
        update: { name, price, stock, barcode },
        create: { sku, name, price, stock, barcode, categoryId: category.id }
      });
      savedCount++;
    }

    return NextResponse.json({
      success: true,
      message: `${savedCount} ta tovar 1C dan muvaffaqiyatli yuklandi hamda bazaga kiritildi!`
    }, { status: 200 });

  } catch (dbErr: any) {
    console.error('[1C DB SAVE ERROR]:', dbErr);
    return NextResponse.json({
      success: false,
      message: `Ma'lumotlar bazasiga saqlashda xatolik: ${dbErr.message}`
    }, { status: 500 });
  }
}
