import { createPixCharge, getPixStatus } from 'backend/pix.web';
import wixWindowFrontend from 'wix-window-frontend';

let currentDonationId = null;
let currentPixCode = '';
let pollTimer = null;

$w.onReady(function () {
  const textoInicial = 'Clique acima para copiar o Pix';

  $w('#ajudaPix').text = textoInicial;

  const copiarPixFixo = async () => {
    try {
      await wixWindowFrontend.copyToClipboard('doe@institutocomuta.org.br');
      $w('#ajudaPix').text = 'Pix copiado';
    } catch (error) {
      console.log('Erro ao copiar Pix:', error);
      $w('#ajudaPix').text = 'Nao foi possivel copiar o Pix';
    }

    setTimeout(() => {
      $w('#ajudaPix').text = textoInicial;
    }, 2000);
  };

  $w('#btnCopiarPix').onClick(copiarPixFixo);
  $w('#ajudaPix').onClick(copiarPixFixo);
  $w('#text2').onClick(copiarPixFixo);

  prepararTela();
  configurarBotoesDeValor();
  configurarBotaoGerar();
  configurarCliqueNoCodigo();
});

function prepararTela() {
  $w('#inputValor').value = '';
  $w('#inputEmail').value = '';

  $w('#txtMensagem').text = 'Seu QR Code aparecera aqui';
  $w('#txtPix').text = '';
  $w('#txtStatus').text = '';
  $w('#txtExpiracao').text = '';
  $w('#txtAjuda').text = '';
  $w('#txtLinkPix').text = '';

  $w('#imgQr').hide();
  $w('#imgQr').collapse();

  $w('#txtPix').hide();
  $w('#txtPix').collapse();

  $w('#txtAjuda').hide();
  $w('#txtAjuda').collapse();

  $w('#txtStatus').hide();
  $w('#txtStatus').collapse();

  $w('#txtExpiracao').hide();
  $w('#txtExpiracao').collapse();

  $w('#txtLinkPix').hide();
  $w('#txtLinkPix').collapse();
}

function configurarBotoesDeValor() {
  $w('#btn20').onClick(() => {
    $w('#inputValor').value = '20';
  });

  $w('#btn30').onClick(() => {
    $w('#inputValor').value = '30';
  });

  $w('#btn50').onClick(() => {
    $w('#inputValor').value = '50';
  });

  $w('#btn100').onClick(() => {
    $w('#inputValor').value = '100';
  });
}

function configurarBotaoGerar() {
  $w('#btnGerarPix').onClick(async () => {
    const amountRaw = String($w('#inputValor').value || '').trim();
    const email = String($w('#inputEmail').value || '').trim();
    const amount = Number(amountRaw.replace(',', '.'));

    limparResultado();
    $w('#txtMensagem').text = 'Gerando QR Code...';

    if (!amountRaw || Number.isNaN(amount) || amount <= 0) {
      await $w('#inputValor').scrollTo();
      $w('#inputValor').focus();
      $w('#txtMensagem').text = 'Seu QR Code aparecera aqui';
      return;
    }

    if (!email || !email.includes('@') || !email.includes('.')) {
      await $w('#inputEmail').scrollTo();
      $w('#inputEmail').focus();
      $w('#txtMensagem').text = 'Seu QR Code aparecera aqui';
      return;
    }

    try {
      const result = await createPixCharge({ amount, email });
      console.log('RESULTADO FRONT:', result);

      currentDonationId = result.donationId || null;
      currentPixCode = result.pixCode || '';

      if (result.qrCodeImage) {
        $w('#imgQr').src = result.qrCodeImage;
        $w('#imgQr').expand();
        $w('#imgQr').show();
      }

      if (currentPixCode) {
        $w('#txtPix').text = currentPixCode;
        $w('#txtPix').expand();
        $w('#txtPix').show();

        $w('#txtAjuda').text = 'Clique no codigo para copiar ou leia o QR Code';
        $w('#txtAjuda').expand();
        $w('#txtAjuda').show();
      }

      if (result.ticketUrl) {
        $w('#txtLinkPix').text = result.ticketUrl;
        $w('#txtLinkPix').expand();
        $w('#txtLinkPix').show();
      }

      if (result.status) {
        $w('#txtStatus').text = 'Status: ' + traduzirStatus(result.status);
        $w('#txtStatus').expand();
        $w('#txtStatus').show();
      }

      if (result.expiresAt) {
        $w('#txtExpiracao').text =
          'Expira em: ' + new Date(result.expiresAt).toLocaleString('pt-BR');
        $w('#txtExpiracao').expand();
        $w('#txtExpiracao').show();
      }

      $w('#txtMensagem').text = 'Seu QR Code aparecera aqui';
      iniciarConsultaStatus();
    } catch (error) {
      console.log('Erro ao gerar PIX:', error);
      $w('#txtMensagem').text = 'Erro ao gerar PIX';
    }
  });
}

function configurarCliqueNoCodigo() {
  $w('#txtPix').onClick(async () => {
    await copiarCodigoPix();
  });
}

async function copiarCodigoPix() {
  if (!currentPixCode) return;

  try {
    await wixWindowFrontend.copyToClipboard(currentPixCode);
    $w('#txtAjuda').text = 'Codigo copiado com sucesso.';
  } catch (error) {
    console.log('Falha ao copiar:', error);
    $w('#txtAjuda').text = 'Nao foi possivel copiar automaticamente.';
  }

  $w('#txtAjuda').expand();
  $w('#txtAjuda').show();
}

function limparResultado() {
  currentDonationId = null;
  currentPixCode = '';

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  $w('#imgQr').hide();
  $w('#imgQr').collapse();

  $w('#txtPix').text = '';
  $w('#txtPix').hide();
  $w('#txtPix').collapse();

  $w('#txtAjuda').text = '';
  $w('#txtAjuda').hide();
  $w('#txtAjuda').collapse();

  $w('#txtStatus').text = '';
  $w('#txtStatus').hide();
  $w('#txtStatus').collapse();

  $w('#txtExpiracao').text = '';
  $w('#txtExpiracao').hide();
  $w('#txtExpiracao').collapse();

  $w('#txtLinkPix').text = '';
  $w('#txtLinkPix').hide();
  $w('#txtLinkPix').collapse();
}

function iniciarConsultaStatus() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  pollTimer = setInterval(async () => {
    if (!currentDonationId) return;

    try {
      const result = await getPixStatus(currentDonationId);
      console.log('STATUS FRONT:', result);

      if (result && result.status) {
        $w('#txtStatus').text = 'Status: ' + traduzirStatus(result.status);
        $w('#txtStatus').expand();
        $w('#txtStatus').show();
      }
    } catch (error) {
      console.log('Erro ao consultar status:', error);
    }
  }, 15000);
}

function traduzirStatus(status) {
  if (status === 'approved') return 'pago';
  if (status === 'pending') return 'aguardando pagamento';
  if (status === 'in_process') return 'em processamento';
  if (status === 'rejected') return 'rejeitado';
  if (status === 'cancelled') return 'cancelado';
  return status;
}
