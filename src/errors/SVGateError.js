class SVGateError extends Error {
  constructor(error) {
    console.log(error);

    super(error.message);

    switch (error.code) {
      case -200:
        this.name = 'CARD_NOT_FOUND';
        break;
      case -240:
        this.name = 'INSUFFICIENT_FUNDS';
        break;
      case -261:
        this.name = 'CARD_BLOCKED';
        break;
      case -270:
      case -314:
      case -317:
        this.name = 'EXPIRED_OTP';
        break;
      case -269:
        this.name = 'WRONG_OTP';
        break;
      case -320:
        this.name = 'CARD_BELONGS_TO_ANOTHER';
        break;
      default:
        this.name = 'SVGATE_ERROR';
        break;
    }
  }
}

module.exports = SVGateError;
