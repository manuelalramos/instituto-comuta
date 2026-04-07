
$w.onReady(function () {

    function contador(elemento, final, sufixo = "", decimal = false) {

        let start = 0;
        let duration = 2000;
        let stepTime = 20;

        let increment = (final - start) / (duration / stepTime);
        let current = start;

        $w(elemento).onViewportEnter(() => {

            let timer = setInterval(() => {

                current += increment;

                let numero;

                if (decimal) {
                    numero = current.toFixed(1);
                } else {
                    numero = Math.round(current);
                }

                $w(elemento).text = `+ ${numero}${sufixo}`;

                if (current >= final) {

                    let finalNumero = decimal ? final.toFixed(1) : final;
                    $w(elemento).text = `+ ${finalNumero}${sufixo}`;

                    clearInterval(timer);
                }

            }, stepTime);

        });

    }

    contador("#text22DAC735", 1500);
    contador("#text22", 500);
    contador("#text22DAC736", 50);
    contador("#text22DAC736DAC737", 4.5, "M", true);

});