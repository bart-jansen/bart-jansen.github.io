<?php
if($_SERVER['REQUEST_METHOD'] == "POST")  {
	if(!empty($_POST['name']) && !empty($_POST['email']) && !empty($_POST['message'])) {
			$_POST = array_map('strip_tags', $_POST);
			$_POST = array_map('stripslashes', $_POST);

			$naam = $_POST['name'];
			$email = $_POST['email'];
			$to = 'bj@psyched.nl';

			$headers="";
			$headers .= "X-Sender:  $naam <$email>\r\n";
			$headers .= "From: $naam <$email>\r\n";
			$headers .= "Reply-To: $naam <$email>\r\n";
			$headers .= "Date: ".date("r")."\r\n";
			$headers .= "Subject: Bart-Jansen.com - Contact\r\n"; // subject write here
			$headers .= "Return-Path: $naam <$email>\r\n";
			$headers .= "Delivered-to: Bart Jansen <$to>\r\n";
			$headers .= "MIME-Version: 1.0\r\n";
			$headers .= "Content-type: text/html;charset=ISO-8859-9\r\n";
			$headers .= "X-Mailer: php\r\n";


			mail($to, "Bart-Jansen.com - Contact", "Beste Bart<br/>" . nl2br($_POST['message']), $headers);
			echo "SEND";
	}
	else {
		echo "Please fill in all required fields.";
	}
}
?>
