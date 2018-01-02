module.exports = (blocc) => {
	var currentLightState = false;
	
	blocc.ontransaction = (from, to, value, data) => {
		// console.log("WOW A NEW TRANSACTION", from, to, value, data);
		
		if (to == "0x55554") {
			currentLightState = !currentLightState;
			console.log("The light is now " + (currentLightState ? "on" : "off"));
		}
	};
};