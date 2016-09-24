var map;

document.addEventListener("DOMContentLoaded", function() {
	var $logo 	= $('#logo');

	// Show logo
	$('.tab-resume,.tab-education,.tab-portfolio,.tab-contact').click(function() {
	  $logo.fadeIn('slow');
	});

	if(window.location.hash && window.location.hash != "#profile") {
	  $logo.fadeIn('slow');
	}

	// Hide logo
	$('.tab-profile').click(function() {
	  $logo.fadeOut('slow');
	});

	/* ---------------------------------------------------------------------- */
	/*	Menu
	/* ---------------------------------------------------------------------- */

	// Needed variables
	var $content = $("#content");

	$('.pdf_icon').css('opacity', 0.4);
	$('.cv').hover(
		function() {
			$('.pdf_icon').stop().fadeTo(250, 1);
			$('.cv').stop().animate({'color': "#d6141d"}, 250);
		},
		function() {
			$('.pdf_icon').stop().fadeTo(250, 0.4);
			$('.cv').stop().animate({'color': "#333"}, 250);
		}
	);

	$('.cv').click(
		function() {
			window.open(
				'cv.pdf',
				'_blank'
			);
		}
	);

	// Run easytabs
  	$content.easytabs({
	  animate			: true,
	  updateHash		: false,
	  transitionIn		:'slideDown',
	  transitionOut		:'slideUp',
	  animationSpeed	:600,
	  tabs				:"> .menu > ul > li",
	  tabActiveClass	:'active',
	});

	// Hover menu effect
	$content.find('.tabs li a').hover(
		function() {
			$(this).stop().animate({ marginTop: "-7px" }, 200);
		},function(){
			$(this).stop().animate({ marginTop: "0px" }, 300);
		}
	);

	// logo click (only available on phone)
	$("#logo").click(function() {
		if($(window).width() < 460) {
			$("#content").easytabs('select', '#profile');
		}
	});

	//add hashes to address bar for refresh purposes
	$('.tabs li a').click(
		function(e,d) {
			if(e.target.hash) {
				window.location.hash = e.target.hash.substring(1);
			}
		}
	);
	/* ---------------------------------------------------------------------- */
	/*	Resume and Education
	/* ---------------------------------------------------------------------- */
	$('.timelineUnit h4').click(function(){
		if($(this).attr('rel')) {
			window.open($(this).attr('rel'));
		}
	});

	/* ---------------------------------------------------------------------- */
	/*	Portfolio
	/* ---------------------------------------------------------------------- */

	// Needed variables
	var $container	 	= $('#portfolio-list');
	var $filter 		= $('#portfolio-filter');

	// Run Isotope
	$container.isotope({
		filter				: '*',
		layoutMode   		: 'masonry',
		animationOptions	: {
		duration			: 750,
		easing				: 'linear'
	   }
	});

	//onchange relayout (phones/tablets)
	jQuery( window ).on( "orientationchange", function() { $container.isotope('reLayout'); } );

	// Isotope Filter
	$filter.find('a').click(function(e){
		e.preventDefault();
		var selector = $(this).attr('data-filter');
		$container.isotope({
			filter				: selector,
			animationOptions	: {
				duration			: 750,
				easing				: 'linear',
				queue				: false,
			}
		});

		var currentOption = $(this).attr('data-filter');
		$filter.find('a').removeClass('current');
		$(this).addClass('current');
	});

	/* ---------------------------------------------------------------------- */
	/*	Fancybox
	/* ---------------------------------------------------------------------- */

	$container.find('.folio').fancybox({
		'transitionIn'		:	'elastic',
		'transitionOut'		:	'elastic',
		'speedIn'			:	200,
		'speedOut'			:	200,
		'overlayOpacity'	:   0.6
	});

	// Portfolio image animation (non touch devices only)
	if(!isTouchDevice()) {
		$container.find('img').adipoli({
			'startEffect' 	: 'transparent',
			'hoverEffect' 	: 'normal',
			'imageOpacity' 	: 0.6
		});
	}

	/* ---------------------------------------------------------------------- */
	/*	Contact Form
	/* ---------------------------------------------------------------------- */

	// Needed variables
	var $contactform 	= $('#contactform');
		// $success		= 'Your message has been sent. Thank you!';

	$contactform.submit(function(){
		setTimeout(function() {


			// $contactform.slideUp();
			var response = '<div class="error">Whoa! I got lazy and never implemented this..  Try <a href="mailto:b@rtjansen.nl">b@rtjansen.nl</a> instead.</div>';

			// Hide any previous response text
			$(".error,.success").remove();
			// Show response message
			$("#contact-status").html(response);

		}, 100);

		// $.ajax({
		//    type: "POST",
		//    url: "contact.php",
		//    data: $(this).serialize(),
		//    success: function(msg) {
		// 		if(msg == 'SEND') {
		// 			$contactform.slideUp();
		// 			response = '<div class="success">'+ $success +'</div>';
		// 		}
		// 		else {
		// 			response = '<div class="error">'+ msg +'</div>';
		// 		}
		// 		// Hide any previous response text
		// 		$(".error,.success").remove();
		// 		// Show response message
		// 		$("#contact-status").html(response);
		// 	}
		//  });
		return false;
	});
	/* ---------------------------------------------------------------------- */
	/*	Google Maps
	/* ---------------------------------------------------------------------- */
	//load without tab select (=refresh)
	if(window.location.hash == "#contact") {
		startGmap();
	}

	//load with after tab select load
	$content.bind('easytabs:after', function(evt,tab,panel) {
		if ( tab.hasClass('tab-contact') ) {
			startGmap();
		}
  	});

	if(isTouchDevice()) {
		socialHighlight();
	}

	var hr = "";

	//check if high density pixel screen
	if(window.devicePixelRatio && window.devicePixelRatio > 1) {
		hr = "hr/";
	}

	//preload hover-on images
	preload([
		'img/'+hr+'contact-icon-active.png',
		'img/'+hr+'education-icon-active.png',
		'img/'+hr+'portfolio-icon-active.png',
		'img/'+hr+'profile-icon-active.png',
		'img/'+hr+'resume-icon-active.png'
	]);
});

function startGmap() {
	if($("#map").children().length === 0) {
		map = new GMaps({
			el: '#map',
			lat: 52.100070,
			lng: 5.119874,
			zoom: 12,
			draggable: ($(window).width() < 600 && isTouchDevice() ? false : true),
			scrollwheel: false,
			zoomControl : true,
			panControl : false,
			streetViewControl : false,
			mapTypeControl: false,
			overviewMapControl: true
		});

		 map.addMarker({
			lat: 52.101080,
			lng: 5.119884
		});
	}
}

function socialHighlight() {
	var speed = 500;
	$('.social-facebook').animate({backgroundColor: '#3b5998'}, speed, function() {
		$('.social-facebook').animate({backgroundColor: '#222'}, speed);
		$('.social-twitter').animate({backgroundColor: '#22b1e5'}, speed, function() {
			$('.social-twitter').animate({backgroundColor: '#222'}, speed);
			$('.social-in').animate({backgroundColor: '#0075a1'}, speed, function() {
				$('.social-in').animate({backgroundColor: '#222'}, speed);
				$('.social-googleplus').animate({backgroundColor: '#d94a38'}, speed, function() {
					$('.social-googleplus').animate({backgroundColor: '#222'}, speed);
				});
			});
		});
	});

	setTimeout(function(){
		socialHighlight()
	},12000);
}

function isTouchDevice() {
  try {
    document.createEvent("TouchEvent");
    return true;
  } catch (e) {
    return false;
  }
}

function preload(arrayOfImages) {
    $(arrayOfImages).each(function(){
        $('<img/>')[0].src = this;
    });
}
