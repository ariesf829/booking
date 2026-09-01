import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'https://esm.sh/resend@4';

Deno.serve(async (request) => {
  try {
    const { bookingId } = await request.json();
    if (!bookingId) return new Response('bookingId is required', { status: 400 });

    const accessToken = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!accessToken) return new Response('Authentication required', { status: 401 });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { data: authData } = await supabase.auth.getUser(accessToken);
    if (!authData.user) return new Response('Authentication required', { status: 401 });
    const { data: admin } = await supabase.from('profiles').select('role').eq('id', authData.user.id).single();
    if (admin?.role !== 'admin') return new Response('Admin access required', { status: 403 });

    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, court_number, booking_date, start_hour, amount, profiles(full_name, phone_number)')
      .eq('id', bookingId)
      .eq('status', 'confirmed')
      .single();
    if (error || !booking) return new Response('Confirmed booking not found', { status: 404 });

    const profile = Array.isArray(booking.profiles) ? booking.profiles[0] : booking.profiles;
    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
    await resend.emails.send({
      from: Deno.env.get('RESEND_FROM_EMAIL')!,
      to: [Deno.env.get('BOOKING_NOTIFICATION_EMAIL')!],
      subject: `Rally Reserve booking confirmed · ${booking.booking_date}`,
      html: `<p>Hi ${profile?.full_name ?? 'there'},</p><p>Your Rally Reserve booking is confirmed for Court ${booking.court_number} on ${booking.booking_date} at ${String(booking.start_hour).padStart(2, '0')}:00.</p><p>Amount paid: ₱${booking.amount}</p>`
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unexpected error' }, { status: 500 });
  }
});
